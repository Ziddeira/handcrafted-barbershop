// Handcrafted The Barbershop — zero-dependency Node.js server.
// Serves the static site from ./public and a small JSON API under /api.

import http from 'node:http';
import { readFile, appendFile, mkdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getOpenStatus } from './public/js/hours.js';

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

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': [
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com",
    "script-src 'self'",
    "connect-src 'self'",
    'frame-src https://www.google.com https://maps.google.com',
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};

const MAX_BODY_BYTES = 10 * 1024;
const RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 5 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+()\-.\s\d]{7,20}$/;

export async function loadBusiness() {
  return JSON.parse(await readFile(path.join(PUBLIC_DIR, 'data', 'business.json'), 'utf8'));
}

/** Validates a contact payload. Returns { ok, errors, value }. */
export function validateContact(body) {
  const errors = {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const value = {
    name: str(body?.name),
    contact: str(body?.contact),
    service: str(body?.service),
    message: str(body?.message),
  };

  if (value.name.length < 2 || value.name.length > 80) errors.name = 'Please enter your name.';
  if (!EMAIL_RE.test(value.contact) && !PHONE_RE.test(value.contact)) {
    errors.contact = 'Enter a valid email or phone number.';
  }
  if (value.service.length > 60) errors.service = 'Service name is too long.';
  if (value.message.length < 5 || value.message.length > 1000) {
    errors.message = 'Message must be between 5 and 1000 characters.';
  }

  return { ok: Object.keys(errors).length === 0, errors, value };
}

function sendJson(res, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': MIME['.json'],
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('Invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

export function createApp({
  dataDir = process.env.DATA_DIR || path.join(ROOT, 'data'),
  adminToken = process.env.ADMIN_TOKEN,
  webhookUrl = process.env.CONTACT_WEBHOOK_URL,
  now = () => new Date(),
} = {}) {
  const hits = new Map(); // ip -> [timestamps]
  const messagesFile = path.join(dataDir, 'messages.jsonl');

  function rateLimited(ip) {
    const t = Date.now();
    const recent = (hits.get(ip) || []).filter((ts) => t - ts < RATE_LIMIT.windowMs);
    recent.push(t);
    hits.set(ip, recent);
    return recent.length > RATE_LIMIT.max;
  }

  async function handleContact(req, res) {
    const type = req.headers['content-type'] || '';
    if (!type.includes('application/json')) {
      return sendJson(res, 415, { ok: false, error: 'Expected application/json' });
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      return sendJson(res, err.status || 400, { ok: false, error: err.message });
    }

    // Honeypot: real visitors never fill the hidden "website" field.
    if (body.website) return sendJson(res, 200, { ok: true });

    const ip = req.socket.remoteAddress || 'unknown';
    if (rateLimited(ip)) {
      return sendJson(res, 429, { ok: false, error: 'Too many messages. Please call us instead.' });
    }

    const { ok, errors, value } = validateContact(body);
    if (!ok) return sendJson(res, 422, { ok: false, errors });

    const entry = { ...value, receivedAt: now().toISOString() };
    await mkdir(dataDir, { recursive: true });
    await appendFile(messagesFile, JSON.stringify(entry) + '\n');

    if (webhookUrl) {
      // Optional: forward to Slack/Discord/Zapier etc. Failures must not break the form.
      fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: `New message from ${entry.name} (${entry.contact})${entry.service ? ` — ${entry.service}` : ''}:\n${entry.message}`,
        }),
      }).catch((err) => console.error('Webhook failed:', err.message));
    }

    return sendJson(res, 201, { ok: true });
  }

  async function handleMessages(req, res) {
    const auth = req.headers.authorization || '';
    if (!adminToken || auth !== `Bearer ${adminToken}`) {
      return sendJson(res, 401, { ok: false, error: 'Unauthorized' });
    }
    let raw = '';
    try {
      raw = await readFile(messagesFile, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    const messages = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line)).reverse();
    return sendJson(res, 200, { ok: true, messages });
  }

  async function serveStatic(req, res, pathname) {
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return sendJson(res, 400, { ok: false, error: 'Bad request' });
    }
    let filePath = path.normalize(path.join(PUBLIC_DIR, decoded));
    if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) return sendJson(res, 403, { ok: false, error: 'Forbidden' });

    let info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      info = await stat(filePath).catch(() => null);
    }

    if (!info) {
      const notFound = path.join(PUBLIC_DIR, '404.html');
      res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': MIME['.html'] });
      return createReadStream(notFound).pipe(res);
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
      if (pathname === '/healthz') return sendJson(res, 200, { ok: true });

      if (pathname === '/api/status' && req.method === 'GET') {
        const business = await loadBusiness();
        return sendJson(res, 200, getOpenStatus(business.hours, business.timezone, now()));
      }

      if (pathname === '/api/info' && req.method === 'GET') {
        const business = await loadBusiness();
        return sendJson(res, 200, { ...business, status: getOpenStatus(business.hours, business.timezone, now()) });
      }

      if (pathname === '/api/contact') {
        if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'Method not allowed' }, { Allow: 'POST' });
        return await handleContact(req, res);
      }

      if (pathname === '/api/messages' && req.method === 'GET') return await handleMessages(req, res);

      if (pathname.startsWith('/api/')) return sendJson(res, 404, { ok: false, error: 'Not found' });

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendJson(res, 405, { ok: false, error: 'Method not allowed' }, { Allow: 'GET, HEAD' });
      }
      return await serveStatic(req, res, pathname);
    } catch (err) {
      console.error(err);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'Internal server error' });
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
