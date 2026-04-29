const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 5500);
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function send(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function handler(req, res) {
  const reqUrl = new URL(req.url, `http://${HOST}:${PORT}`);
  let pathname = decodeURIComponent(reqUrl.pathname);

  if (pathname === '/') pathname = '/trip-vault.html';

  const safePath = path.normalize(path.join(ROOT, pathname));
  if (!safePath.startsWith(ROOT)) {
    return send(res, 403, 'Forbidden');
  }

  fs.stat(safePath, (statErr, stat) => {
    if (statErr || !stat.isFile()) {
      return send(res, 404, 'Not found');
    }

    const ext = path.extname(safePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';

    fs.readFile(safePath, (readErr, data) => {
      if (readErr) return send(res, 500, 'Server error');
      send(res, 200, data, mime);
    });
  });
}

if (require.main === module) {
  const server = http.createServer(handler);
  server.listen(PORT, HOST, () => {
    console.log(`Trip Vault running at http://${HOST}:${PORT}/trip-vault.html`);
  });
}

module.exports = handler;
