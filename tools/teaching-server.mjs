// Local APKG reader. Passwords and cloud tokens never pass through this server.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { prepareTeachingImport } from './teaching-import.mjs';
import { parseFilename } from '../lib/library-rules.js';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.resolve(repo, '../import-work/teaching-upload');
const port = Number(process.env.TEACHING_PORT || 8767), origin = `http://127.0.0.1:${port}`;
const sessions = new Map();
const inside = (root, file) => file.startsWith(root + path.sep);
function removeSession(dir) { if (!inside(work, path.resolve(dir))) throw new Error('Unsafe cleanup path'); fs.rmSync(dir, { recursive: true, force: true }); }
const send = (res, code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };
const server = http.createServer(async (req, res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${port}` || (req.headers.origin && req.headers.origin !== origin)) return send(res, 403, { error: '请从本机导入窗口操作' });
    const u = new URL(req.url, origin), pathname = decodeURIComponent(u.pathname);
    if (pathname === '/_import/health' && req.method === 'GET') return send(res, 200, { app: 'teaching-import', ready: true });
    if (pathname === '/_import/stop' && req.method === 'POST') {
      for (const dir of sessions.values()) removeSession(dir); sessions.clear(); send(res, 200, { stopped: true }); server.close(); return;
    }
    if (pathname === '/_import/check' && req.method === 'POST') {
      const filename = u.searchParams.get('filename'); parseFilename(filename);
      const options = JSON.parse(req.headers['x-import-options'] ? decodeURIComponent(req.headers['x-import-options']) : '{}');
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 200 * 1024 * 1024) { req.resume(); return send(res, 413, { error: '文件超过 200 MB，请拆成较小的词库包' }); } chunks.push(chunk); }
      if (!size) return send(res, 400, { error: '文件为空' });
      for (const dir of sessions.values()) removeSession(dir); sessions.clear();
      fs.mkdirSync(work, { recursive: true });
      const id = crypto.randomBytes(16).toString('hex'), dir = path.join(work, id), input = path.join(dir, 'input.apkg');
      fs.mkdirSync(dir); fs.writeFileSync(input, Buffer.concat(chunks));
      try {
        const plan = await prepareTeachingImport(input, filename, options, dir);
        sessions.set(id, dir); send(res, 200, { id, plan });
      } catch (e) { removeSession(dir); throw e; }
      finally { if (fs.existsSync(input)) fs.unlinkSync(input); }
      return;
    }
    if (pathname.startsWith('/_import/media/')) {
      const [, , , id, name] = pathname.split('/');
      const dir = sessions.get(id);
      if (!dir || !/^[a-f0-9]{20}\.[a-z0-9]{1,6}$/.test(name || '')) return send(res, 404, { error: '预览已失效，请重新校验' });
      const file = path.join(dir, 'media', name);
      if (!fs.existsSync(file)) return send(res, 404, { error: '媒体不存在' });
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); fs.createReadStream(file).pipe(res); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, { error: '不支持的操作' });
    const file = path.resolve(repo, '.' + (pathname === '/' ? '/阅读词-老师登录版本.html' : pathname));
    const relative = path.relative(repo, file).split(path.sep);
    if (!inside(repo, file) || relative.some((x) => x.startsWith('.')) || ['tools', 'node_modules'].includes(relative[0]) || !['.html', '.js', '.css', '.json'].includes(path.extname(file)) || !fs.existsSync(file)) return send(res, 404, { error: '找不到页面' });
    res.writeHead(200, { 'Content-Type': types[path.extname(file)], 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  } catch (e) { send(res, 400, { error: e.message }); }
});
server.listen(port, '127.0.0.1', () => console.log(`词库导入窗口：${origin}/阅读词-老师登录版本.html?import=1`));
server.on('error', (e) => { console.error(e.code === 'EADDRINUSE' ? `导入窗口已在运行，请打开 ${origin}/阅读词-老师登录版本.html?import=1` : e.message); process.exitCode = 1; });
process.on('SIGINT', () => { for (const dir of sessions.values()) removeSession(dir); server.close(() => process.exit()); });
