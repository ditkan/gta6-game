// Dev-only static server for game/: `node serve.ts [--port 8123]` then open
// http://localhost:8123 in a desktop browser. Not part of the entry; the game
// itself is plain static files and any static server will do.

import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('./game', import.meta.url)));
const args = process.argv.slice(2);
const portFlag = args.indexOf('--port');
const port = portFlag === -1 ? 8123 : Number(args[portFlag + 1]) || 8123;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^[/\\]+/, '');
  const file = join(root, rel === '' ? 'index.html' : rel);
  if (!file.startsWith(root + sep) && file !== root) {
    res.writeHead(403).end('forbidden');
    return;
  }
  const target = existsSync(file) && statSync(file).isDirectory() ? join(file, 'index.html') : file;
  if (!existsSync(target)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(target)] ?? 'application/octet-stream' });
  createReadStream(target).pipe(res);
}).listen(port, () => console.log(`Port Azura dev server: http://localhost:${port}`));
