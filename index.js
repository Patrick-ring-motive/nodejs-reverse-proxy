const http = require('http');
const tls = require('tls');
const {inspect} = require('util');
const {Readable} = require('stream');

const nparse = x => { try{ return JSON.parse(x); }catch{} };
const targets = nparse(process.env.HOST_TARGETS);

const fetchResponse = async (...args) => {
  try {
    return await fetch(...args);
  } catch(e) {
    console.warn(e, ...args);
    return new Response(inspect(e), { status: 500, statusText: String(e) });
  }
};

const skipHeaders = [
  'content-length','content-encoding','x-content-type-options',
  'x-dns-prefetch-control','x-frame-options','referrer-policy',
  'content-security-policy','x-xss-protection','x-forwarded',
  'forwarded'
];
const shouldSkip = key => skipHeaders.some(x => RegExp(x,'i').test(key));

const rewriteAll = (str, localhost) => {
  for (const t of targets) str = str.replaceAll(t, localhost);
  return str;
};

const server = http.createServer(async (req, res) => {
  try {
    const localhost = req.headers['host'];
    const method = String(req.method).toUpperCase();
    const options = { method, redirect: 'manual' };
    let stream, request, response, hostTarget;

    if(!/GET|HEAD/.test(method)) {
      stream = new Response(Readable.toWeb(req));
    }
    for(hostTarget of targets) {
      const url = `https://${hostTarget}${req.url}`;
      options.headers = new Headers();
      for(const key in req.headers) {
        try {
          if(shouldSkip(key)) continue;
          options.headers.set(key, String(req.headers[key]).replaceAll(localhost, hostTarget));
        } catch(e) { console.warn(e, key, req.headers[key]); }
      }
      if(stream){
        options.body = stream.clone().body;
        options.duplex = 'half';
      }
      request = new Request(url, options);
      response = await fetchResponse(request.clone());
      if(/^[23]/.test(response.status)) break;
      console.warn(request, response);
    }

    res.statusCode = response.status;
    res.statusMessage = response.statusText;
    for(const [key, value] of response.headers) {
      try {
        if(shouldSkip(key) || key === 'set-cookie') continue;
        res.setHeader(key, rewriteAll(value, localhost));
      } catch(e) { console.warn(e, key, value); }
    }
    const cookies = response.headers.getSetCookie();
    if(cookies.length) {
      res.setHeader('set-cookie', cookies.map(c => rewriteAll(c, localhost)));
    }

    if(/text|html|script|json|xml/i.test(response.headers.get('content-type'))) {
      let text = await response.text();
      res.write(rewriteAll(text, localhost));
    } else {
      for await (const chunk of response?.body ?? []) res.write(chunk);
    }
    res.end();
  } catch(e) {
    try {
      res.statusCode = 500;
      res.statusMessage = String(e);
      res.end(inspect(e));
    } catch{}
  }
});

// WebSocket tunnel
server.on('upgrade', async (req, clientSocket, head) => {
  const localhost = req.headers['host'];
  let targetSocket, hostTarget;

  for(const target of targets) {
    try {
      await new Promise((resolve, reject) => {
        const sock = tls.connect({ host: target, port: 443 }, () => {
          targetSocket = sock;
          hostTarget = target;
          resolve();
        });
        sock.once('error', reject);
      });
      break;
    } catch(e) { console.warn('WS connect failed:', target, e.message); }
  }

  if(!targetSocket) {
    clientSocket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');
    return;
  }

  let raw = `${req.method} ${req.url} HTTP/1.1\r\n`;
  for(const key of Object.keys(req.headers)) {
    if(shouldSkip(key)) continue;
    raw += `${key}: ${String(req.headers[key]).replaceAll(localhost, hostTarget)}\r\n`;
  }
  raw += '\r\n';

  targetSocket.write(raw);
  if(head?.length) targetSocket.write(head);

  targetSocket.pipe(clientSocket);
  clientSocket.pipe(targetSocket);

  const cleanup = () => { try{ targetSocket.destroy(); }catch{} try{ clientSocket.destroy(); }catch{} };
  targetSocket.on('error', cleanup);
  clientSocket.on('error', cleanup);
  targetSocket.on('end', () => clientSocket.end());
  clientSocket.on('end', () => targetSocket.end());
});

server.listen(8080);
