// API handlers written against the Web Request/Response standard, so the same code
// runs as Vercel Functions (api/*.js) and inside the local Node server (server.js).

import { getOpenStatus } from '../public/js/hours.js';
import { storeFromEnv } from './store.js';
import business from '../public/data/business.json' with { type: 'json' };

const MAX_BODY_BYTES = 10 * 1024;
const RATE_LIMIT = { windowMs: 10 * 60 * 1000, max: 5 };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+()\-.\s\d]{7,20}$/;
const CALL_US = 'Please call us at (650) 763-1332.';

export { business };

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

export function json(status, data, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

/** Best client IP: Vercel/proxies set x-forwarded-for, the local server passes the socket address. */
export function clientIp(request, fallback = 'unknown') {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded ? forwarded.split(',')[0].trim() : request.headers.get('x-real-ip') || fallback;
}

async function readBody(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return { tooLarge: true };
  if (!request.body) return { text: '' };

  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return { tooLarge: true };
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks).toString('utf8') };
}

export function createApi({
  store = storeFromEnv(),
  adminToken = process.env.ADMIN_TOKEN,
  webhookUrl = process.env.CONTACT_WEBHOOK_URL,
  now = () => new Date(),
} = {}) {
  // In-memory, so per server instance (best effort on serverless).
  const hits = new Map();

  function rateLimited(ip) {
    const t = Date.now();
    const recent = (hits.get(ip) || []).filter((ts) => t - ts < RATE_LIMIT.windowMs);
    recent.push(t);
    hits.set(ip, recent);
    return recent.length > RATE_LIMIT.max;
  }

  async function notifyWebhook(entry) {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `New message from ${entry.name} (${entry.contact})${entry.service ? ` — ${entry.service}` : ''}:\n${entry.message}`,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`Webhook responded ${res.status}`);
  }

  return {
    status() {
      return json(200, getOpenStatus(business.hours, business.timezone, now()));
    },

    info() {
      return json(200, { ...business, status: getOpenStatus(business.hours, business.timezone, now()) });
    },

    async contact(request, ip = clientIp(request)) {
      if (!(request.headers.get('content-type') || '').includes('application/json')) {
        return json(415, { ok: false, error: 'Expected application/json' });
      }

      const { text, tooLarge } = await readBody(request);
      if (tooLarge) return json(413, { ok: false, error: 'Payload too large' });

      let body;
      try {
        body = JSON.parse(text || '{}');
      } catch {
        return json(400, { ok: false, error: 'Invalid JSON' });
      }

      // Honeypot: real visitors never fill the hidden "website" field.
      if (body.website) return json(200, { ok: true });

      if (rateLimited(ip)) return json(429, { ok: false, error: `Too many messages. ${CALL_US}` });

      const { ok, errors, value } = validateContact(body);
      if (!ok) return json(422, { ok: false, errors });

      if (!store && !webhookUrl) {
        return json(503, { ok: false, error: `Online messages aren't available right now. ${CALL_US}` });
      }

      // Succeed if at least one channel (store or webhook) actually took the message.
      const entry = { ...value, receivedAt: now().toISOString() };
      let delivered = false;
      if (store) {
        try {
          await store.add(entry);
          delivered = true;
        } catch (err) {
          console.error('Saving message failed:', err.message);
        }
      }
      if (webhookUrl) {
        try {
          await notifyWebhook(entry);
          delivered = true;
        } catch (err) {
          console.error('Webhook failed:', err.message);
        }
      }

      return delivered
        ? json(201, { ok: true })
        : json(502, { ok: false, error: `Couldn't send right now. ${CALL_US}` });
    },

    async messages(request) {
      if (!adminToken || request.headers.get('authorization') !== `Bearer ${adminToken}`) {
        return json(401, { ok: false, error: 'Unauthorized' });
      }
      if (!store) return json(503, { ok: false, error: 'No message store configured' });
      return json(200, { ok: true, messages: await store.list() });
    },
  };
}
