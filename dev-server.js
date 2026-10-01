// Handcrafted The Barbershop — zero-dependency Node.js server for local use or any Node host.
// (Not named server.js on purpose: that name makes Vercel auto-detect its "Node.js" preset.)
// Serves the static site from ./public and the same /api handlers that run on Vercel.

import http from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApi, json } from './lib/api.js';
import { fileStore, storeFromEnv } from './lib/store.js';
import { SECURITY_HEADERS } from './lib/headers.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function toWebRequest(req) {
  const init = { method: req.method, headers: req.headers };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.body = Readable.toWeb(req);
    init.duplex = 'half';
  }
  return new Request(new URL(req.url, 'http://localhost'), init);
}

async function sendWebResponse(res, response) {
  res.writeHead(response.status, { ...SECURITY_HEADERS, ...Object.fromEntries(response.headers) });
  res.end(Buffer.from(await response.arrayBuffer()));
}

export function createApp({ dataDir, ...apiOptions } = {}) {
  const api = createApi({ store: dataDir ? fileStore(dataDir) : storeFromEnv(), ...apiOptions });

  const routes = {
    '/api/status': { GET: () => api.status() },
    '/api/info': { GET: () => api.info() },
    '/api/contact': { POST: (request, ip) => api.contact(request, ip) },
    '/api/messages': { GET: (request) => api.messages(request) },
  };

  async function serveStatic(req, res, pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return sendWebResponse(res, json(400, { ok: false, error: 'Bad request' }));
    }
    let filePath = path.normalize(path.join(PUBLIC_DIR, decoded));
    if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
      return sendWebResponse(res, json(403, { ok: false, error: 'Forbidden' }));
    }

    let info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      info = await stat(filePath).catch(() => null);
    }

    if (!info) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': MIME['.html'] });
      return createReadStream(path.join(PUBLIC_DIR, '404.html')).pipe(res);
    }

    const ext = path.extname(filePath).toLowerCase();
    const isAsset = ['.jpg', '.jpeg', '.png', '.webp', '.svg', '.ico'].includes(ext);
    const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
    const headers = {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': isAsset ? 'public, max-age=604800' : 'public, max-age=0, must-revalidate',
      ETag: etag,
    };

    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      return res.end();
    }

    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    createReadStream(filePath).pipe(res);
  }

  return async function app(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');

    try {
      if (pathname === '/healthz') return await sendWebResponse(res, json(200, { ok: true }));

      const route = routes[pathname];
      if (route) {
        const handler = route[req.method];
        if (!handler) {
          return await sendWebResponse(res, json(405, { ok: false, error: 'Method not allowed' }, { Allow: Object.keys(route).join(', ') }));
        }
        return await sendWebResponse(res, await handler(toWebRequest(req), req.socket.remoteAddress || 'unknown'));
      }

      if (pathname.startsWith('/api/')) return await sendWebResponse(res, json(404, { ok: false, error: 'Not found' }));

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return await sendWebResponse(res, json(405, { ok: false, error: 'Method not allowed' }, { Allow: 'GET, HEAD' }));
      }
      return await serveStatic(req, res, pathname);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) await sendWebResponse(res, json(500, { ok: false, error: 'Internal server error' }));
      else res.end();
    }
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT) || 3000;
  http.createServer(createApp()).listen(port, () => {
    console.log(`Handcrafted The Barbershop running at http://localhost:${port}`);
  });
}
