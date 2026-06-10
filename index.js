const http = require('http');
const {inspect} = require('util');
const {Readable} = require('stream');
const hostTarget = process.env.HOST_TARGET;

const fetchResponse = async (...args) => {
  try {
    return await fetch(...args);
  } catch (e) {
    console.warn(e, ...args);
    return new Response(String(e), {
      status: 500,
      statusText: String(e)
    });
  }
};

http.createServer(async(req, res) => {
  try{
    const localhost = req.headers['host'];
    const url = `https://${hostTarget}${req.path}`;
    const headers = new Headers(req.rawHeaders.map(([key,value])=>[key,value.replace(localhost,hostTarget)]));
    const method = String(req.method).toUpperCase();
    const options = {method,headers};
    if(/GET|HEAD/.test(method) && req.body){
      options.body = Readable.toWeb(req.body);
    }
    const request = new Request(url,options);
    const response = await fetchResponse(request);
    res.statusCode = response.status;
    res.statusMessage = response.status;
    for(const [key,value] of response.headers){
      try{
        res.headers.set(key,value);
      }catch(e){
        console.warn(e,key,value);
      }
    }
    for await (const chunk of response?.body ?? []) {
      res.write(chunk);
    }

    res.end();
  }catch(e){
    console.warn(e,req,res);
    const msg = String(e);
    try{
      res.statusCode = 500;
      res.statusMessage = msg;
      res.end(msg);
    }catch{}
  }
}).listen(8080);
