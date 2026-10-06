'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname);
const port = Number(process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT 必须是 1～65535 的整数。');
  process.exit(1);
}
const mime = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.graphite': 'application/json; charset=utf-8'
};
function respond(res, status, message) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  res.end(message);
}
const server = http.createServer(async function (req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    respond(res, 405, '仅支持读取本地文件。');
    return;
  }
  let requestPath;
  try { requestPath = decodeURIComponent((req.url || '/').split(/[?#]/)[0]); }
  catch (_) { respond(res, 400, '请求路径格式错误。'); return; }
  const parts = requestPath.replace(/\\/g, '/').split('/').filter(Boolean);
  if (requestPath.includes('\0') || parts.some(function (part) { return part.startsWith('.') || part.includes(':'); })) {
    respond(res, 403, '不允许访问该路径。');
    return;
  }
  let file = path.resolve(root, parts.join(path.sep) || 'index.html');
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) { respond(res, 403, '不允许访问该路径。'); return; }
  try {
    let stat = await fs.promises.stat(file);
    if (stat.isDirectory()) { file = path.join(file, 'index.html'); stat = await fs.promises.stat(file); }
    const canonical = await fs.promises.realpath(file);
    const canonicalRelative = path.relative(root, canonical);
    if (canonicalRelative.startsWith('..') || path.isAbsolute(canonicalRelative) || canonicalRelative.split(path.sep).some(function (part) { return part.startsWith('.'); })) {
      respond(res, 403, '不允许访问该路径。');
      return;
    }
    if (!stat.isFile()) { respond(res, 404, '文件不存在。'); return; }
    res.writeHead(200, {
      'Content-Type': mime[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = fs.createReadStream(canonical);
    stream.on('error', function () { if (!res.headersSent) respond(res, 500, '文件读取失败。'); else res.destroy(); });
    stream.pipe(res);
  } catch (error) {
    respond(res, error.code === 'ENOENT' || error.code === 'ENOTDIR' ? 404 : 500, error.code === 'ENOENT' || error.code === 'ENOTDIR' ? '文件不存在。' : '文件读取失败。');
  }
});
server.on('error', function (error) {
  console.error(error.code === 'EADDRINUSE' ? '端口 ' + port + ' 已被占用。请关闭旧服务，或设置 PORT 后重试。' : '服务启动失败：' + error.message);
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', function () {
  console.log('画图软件已启动：http://127.0.0.1:' + port);
  console.log('在浏览器打开以上地址；按 Ctrl+C 关闭服务。');
});
