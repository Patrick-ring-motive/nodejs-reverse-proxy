const http = require('http');
const {inspect} = require('util');
const {Readable} = require('stream');
const hostTarget = process.env.HOST_TARGET;

const fetchResponse = async (...args) => {
  try {
    return await fetch(...args);
  } catch (e) {
    console.warn(e, ...args);
    return new Response(inspect(e), {
      status: 500,
      statusText: String(e)
    });
  }
};

http.createServer(async(req, res) => {
  try{
    const localhost = req.headers['host'];
    const url = `https://${hostTarget}${req.url}`;
    const headers = new Headers();
    for(const key in req.headers){
      try{
        headers.set(key,String(req.headers[key]).replace(localhost,hostTarget));
      }catch(e){
        console.warn(e,key,value);
      }
    }
    const method = String(req.method).toUpperCase();
    const options = {method,headers,redirect:'follow'};
    if(!/GET|HEAD/.test(method) && req.body){
      options.body = Readable.toWeb(req.body);
    }
    const request = new Request(url,options);
    let response = await fetchResponse(request);
    if(!/^2/.test(response.status)){
      console.warn(request,response);
    }
    if(/^3/.test(response.status)&&response.headers.get('location')){
      response = await fetchResponse(response.headers.get('location'));
    }
    res.statusCode = response.status;
    res.statusMessage = response.statusText;
    const skipHeaders = [
      'content-length',
      'content-encoding',
      'x-content-type-options',
      'x-dns-prefetch-control',
      'x-frame-options',
      'referrer-policy',
      'content-security-policy'
    ];
    for(const [key,value] of response.headers){
      try{
        if(skipHeaders.some(x=>RegExp(x,'i').test(key))){
          console.log(`Skipping header ${key}:${value} for ${request.url}`);
          continue;
        }
        res.setHeader(key,value.replace(hostTarget,localhost));
      }catch(e){
        console.warn(e,key,value);
      }
    }
    if(/text|html|script|json|xml/i.test(response.headers.get('content-type'))){
      let text = await response.text();
      text = text.replace(RegExp(hostTarget,'gi'),localhost);
      res.write(text);
    }else{
      for await (const chunk of response?.body ?? []) {
        res.write(chunk);
      }
    }
    res.end();
  }catch(e){
    try{
      console.warn(e,req,res);
      res.statusCode = 500;
      res.statusMessage = String(e);
      res.end(inspect(e));
    }catch{}
  }
}).listen(8080);
