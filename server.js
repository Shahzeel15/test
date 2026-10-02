const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, 'index.html'));
const port = Number(process.env.PORT) || 3000;

http.createServer((request, response) => {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': page.length,
    'Cache-Control': 'public, max-age=300'
  });
  response.end(page);
}).listen(port, '0.0.0.0', () => {
  console.log(`Hello page listening on port ${port}`);
});
