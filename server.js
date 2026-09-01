/**
 * 极简静态文件服务器（零依赖），供本地预览使用。
 * 支持从命令行参数或环境变量读取端口与主机：
 *   node server.js --port 7100 --host 0.0.0.0
 *   PORT=7100 node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.task': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
};

function arg(name, fallback) {
  const i = process.argv.findIndex(a => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return process.env[name.toUpperCase()] || fallback;
  const a = process.argv[i];
  return a.includes('=') ? a.split('=')[1] : (process.argv[i + 1] || fallback);
}

const port = parseInt(arg('port', '8616'), 10);
const host = arg('host', '0.0.0.0');
const root = __dirname;

http.createServer((req, res) => {
  try {
    let urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (urlPath === '/') urlPath = '/index.html';
    const file = path.normalize(path.join(root, urlPath));
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not Found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  } catch (e) {
    res.writeHead(500); res.end('Server Error');
  }
}).listen(port, host, () => {
  console.log(`云游山河 → http://localhost:${port}`);
});
