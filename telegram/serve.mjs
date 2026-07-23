/*
 * Minimal but "real-host-like" static file server for local testing.
 *
 * Why not `python -m http.server`? That serves HTTP/1.0 without keep-alive, and
 * under the ~150 parallel asset requests this libGDX/GWT game makes, a texture
 * can arrive truncated — the game boots but renders a black screen. A normal
 * host (GitHub Pages, nginx, Cloudflare) uses HTTP/1.1+ and works fine; so does
 * this server. Node's http server is HTTP/1.1 with keep-alive by default.
 *
 * Usage:  node telegram/serve.mjs <dir> [port] [host]
 *   e.g.  node telegram/serve.mjs dist-telegram 9200
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] || '.');
const port = parseInt(process.argv[3] || '9200', 10);
const host = process.argv[4] || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8', '.glsl': 'text/plain; charset=utf-8',
  '.fnt': 'text/plain; charset=utf-8', '.symbolMap': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.wasm': 'application/wasm', '.map': 'application/json',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

const server = http.createServer((req, res) => {
  try {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath.endsWith('/')) urlPath += 'index.html';
    const filePath = path.resolve(dir, '.' + path.normalize(urlPath));
    const relativePath = path.relative(dir, filePath);
    if (relativePath.startsWith('..' + path.sep) || path.isAbsolute(relativePath)) {
      res.writeHead(403);
      return res.end('403');
    }
    fs.stat(filePath, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end('404'); }
      const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range) || [];
        let start = m[1] ? parseInt(m[1], 10) : 0;
        let end = m[2] ? parseInt(m[2], 10) : st.size - 1;
        if (isNaN(start) || start < 0) start = 0;
        if (isNaN(end) || end >= st.size) end = st.size - 1;
        if (start > end) { res.writeHead(416); return res.end(); }
        res.writeHead(206, {
          'Content-Type': type,
          'Content-Range': `bytes ${start}-${end}/${st.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': end - start + 1,
          'Cache-Control': 'no-cache',
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Type': type,
          'Content-Length': st.size,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-cache',
        });
        fs.createReadStream(filePath).pipe(res);
      }
    });
  } catch (e) {
    res.writeHead(500); res.end('500');
  }
});

server.listen(port, host, () => {
  console.log(`Serving ${dir}\n  http://${host}:${port}/`);
});
