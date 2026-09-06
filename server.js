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
    // 仅允许只读方法（静态预览服务器，无写接口）
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
    }
    let urlPath;
    try { urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
    catch (e) { res.writeHead(400); res.end('Bad Request'); return; }
    if (urlPath === '/') urlPath = '/index.html';
    // 路径安全：拒绝残余 ".." 段与反斜杠（防编码绕过），并用 relative 严格判定仍位于站点根内
    // （startsWith 前缀判定在 Windows 大小写不敏感/同级同名前缀目录下不可靠）
    if (urlPath.includes('\\') || urlPath.split('/').includes('..')) { res.writeHead(403); res.end(); return; }
    const file = path.normalize(path.join(root, urlPath));
    const rel = path.relative(root, file);
    if (rel === '' || path.isAbsolute(rel) || rel.split(path.sep).includes('..')) {
      res.writeHead(403); res.end(); return;
    }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not Found'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  } catch (e) {
    res.writeHead(500); res.end('Server Error');
  }
}).listen(port, host, () => {
  console.log(`云游山河 → http://localhost:${port}`);
  if (host === '0.0.0.0') console.log('（已监听局域网：手机与电脑同一 WiFi 时可用 http://<电脑IP>:' + port + ' 访问）');
});
