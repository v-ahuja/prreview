import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const contentSecurityPolicy = "default-src 'none'; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:; font-src 'self' data:; img-src 'self' data: blob: https:; form-action 'self' https://github.com; base-uri 'none'; frame-ancestors 'none'";
const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const monacoRoot = fileURLToPath(new URL('../public/vendor/', import.meta.url));
const types = { '.js': 'text/javascript', '.css': 'text/css', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
export async function serveAsset(req, res, pathname) {
  if (req.method !== 'GET') return false;
  const isMonaco = pathname.startsWith('/vendor/');
  if (!isMonaco && !['/style.css', '/walkthrough.js', '/app.js', '/editor.js'].includes(pathname)) return false;
  const root = isMonaco ? monacoRoot : publicRoot;
  const relative = decodeURIComponent(isMonaco ? pathname.slice('/vendor/'.length) : pathname.slice(1));
  const path = resolve(root, relative);
  if (!path.startsWith(root.endsWith(sep) ? root : root + sep) || !types[extname(path)]) {
    res.writeHead(404); res.end('Not found'); return true;
  }
  try {
    const data = await readFile(path);
    res.writeHead(200, { 'Content-Type': `${types[extname(path)]}; charset=utf-8`, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache', 'Content-Security-Policy': contentSecurityPolicy });
    res.end(data);
  } catch { res.writeHead(404); res.end('Asset not found'); }
  return true;
}
