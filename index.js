const http = require('http');
const {inspect} = require('util');

http.createServer((req, res) => {
  res.end(inspect(req));
}).listen(8080);
