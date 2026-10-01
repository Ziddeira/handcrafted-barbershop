// Covers the Vercel deployment: function exports, Web Request/Response handlers,
// storage selection and vercel.json staying in sync with the local server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApi } from '../lib/api.js';
import { redisStore, storeFromEnv } from '../lib/store.js';
import { SECURITY_HEADERS } from '../lib/headers.js';

const contactRequest = (body, headers = {}) =>
  new Request('https://example.com/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.7, 10.0.0.1', ...headers },
    body: JSON.stringify(body),
  });

const valid = { name: 'Alexander', contact: '(650) 555-0101', service: 'Fade / Taper', message: 'Any openings Saturday?' };

function memoryStore() {
  const items = [];
  return { kind: 'memory', items, add: async (e) => void items.unshift(e), list: async () => items };
}

test('each api/*.js file exports the expected HTTP method handler', async () => {
  const expected = { status: 'GET', info: 'GET', contact: 'POST', messages: 'GET' };
  for (const [file, method] of Object.entries(expected)) {
    const mod = await import(`../api/${file}.js`);
    assert.equal(typeof mod[method], 'function', `api/${file}.js should export ${method}`);
  }
});

test('status and info return JSON', async () => {
  const api = createApi({ store: null, now: () => new Date('2026-10-01T18:30:00Z') });
  const status = await api.status().json();
  assert.equal(status.isOpen, true);
  const info = await api.info().json();
  assert.equal(info.phone, '+1 650-763-1332');
  assert.equal(info.status.isOpen, true);
});

test('contact saves to the store and lists with admin token', async () => {
  const store = memoryStore();
  const api = createApi({ store, adminToken: 't0k', webhookUrl: '' });
  const res = await api.contact(contactRequest(valid));
  assert.equal(res.status, 201);
  assert.equal(store.items[0].name, 'Alexander');

  const denied = await api.messages(new Request('https://example.com/api/messages'));
  assert.equal(denied.status, 401);
  const list = await api.messages(new Request('https://example.com/api/messages', { headers: { Authorization: 'Bearer t0k' } }));
  assert.equal((await list.json()).messages.length, 1);
});

test('contact returns 503 when no store or webhook is configured', async () => {
  const api = createApi({ store: null, webhookUrl: '' });
  const res = await api.contact(contactRequest(valid));
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /call us/);
});

test('contact rejects oversized bodies', async () => {
  const api = createApi({ store: memoryStore(), webhookUrl: '' });
  const res = await api.contact(contactRequest({ ...valid, message: 'x'.repeat(20_000) }));
  assert.equal(res.status, 413);
});

test('rate limit keys on the first x-forwarded-for address', async () => {
  const api = createApi({ store: memoryStore(), webhookUrl: '' });
  const statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await api.contact(contactRequest(valid))).status);
  assert.deepEqual(statuses, [201, 201, 201, 201, 201, 429]);
  assert.equal((await api.contact(contactRequest(valid, { 'x-forwarded-for': '198.51.100.2' }))).status, 201);
});

test('webhook-only delivery succeeds, and fails cleanly when the webhook is down', async (t) => {
  const calls = [];
  let ok = true;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response('', { status: ok ? 200 : 500 });
  });

  const api = createApi({ store: null, webhookUrl: 'https://hooks.example.com/x' });
  assert.equal((await api.contact(contactRequest(valid))).status, 201);
  assert.match(calls[0].body.text, /Alexander/);

  ok = false;
  assert.equal((await api.contact(contactRequest(valid, { 'x-forwarded-for': '198.51.100.9' }))).status, 502);
});

test('redisStore speaks the Upstash REST protocol', async (t) => {
  const commands = [];
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer abc');
    const cmd = JSON.parse(init.body);
    commands.push(cmd[0]);
    const result = cmd[0] === 'LRANGE' ? [JSON.stringify({ name: 'Ronaldo' })] : 1;
    return Response.json({ result });
  });

  const store = redisStore('https://redis.example.com', 'abc');
  await store.add({ name: 'Ronaldo' });
  assert.deepEqual(await store.list(), [{ name: 'Ronaldo' }]);
  assert.deepEqual(commands, ['LPUSH', 'LTRIM', 'LRANGE']);
});

test('storeFromEnv picks Redis, then file, and nothing on Vercel without Redis', () => {
  assert.equal(storeFromEnv({ KV_REST_API_URL: 'https://r', KV_REST_API_TOKEN: 't' }).kind, 'redis');
  assert.equal(storeFromEnv({ UPSTASH_REDIS_REST_URL: 'https://r', UPSTASH_REDIS_REST_TOKEN: 't' }).kind, 'redis');
  assert.equal(storeFromEnv({}).kind, 'file');
  assert.equal(storeFromEnv({ VERCEL: '1' }), null);
});

test('vercel.json serves public/ and mirrors the security headers', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(config.outputDirectory, 'public');
  const global = config.headers.find((h) => h.source === '/(.*)');
  assert.deepEqual(Object.fromEntries(global.headers.map((h) => [h.key, h.value])), SECURITY_HEADERS);
});
