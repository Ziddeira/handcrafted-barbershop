import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../dev-server.js';
import { validateContact } from '../lib/api.js';

let server;
let base;
let dataDir;

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'barber-'));
  server = http.createServer(createApp({ dataDir, adminToken: 'secret', webhookUrl: '' }));
  await new Promise((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await rm(dataDir, { recursive: true, force: true });
});

const post = (body, headers = { 'Content-Type': 'application/json' }) =>
  fetch(`${base}/api/contact`, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('validateContact accepts email or phone', () => {
  assert.equal(validateContact({ name: 'Eddie', contact: 'eddie@example.com', message: 'Hello there' }).ok, true);
  assert.equal(validateContact({ name: 'Eddie', contact: '(650) 763-1332', message: 'Hello there' }).ok, true);
  const bad = validateContact({ name: 'E', contact: 'nope', message: 'hi' });
  assert.equal(bad.ok, false);
  assert.deepEqual(Object.keys(bad.errors).sort(), ['contact', 'message', 'name']);
});

test('serves the home page with security headers', async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.ok(res.headers.get('content-security-policy'));
  assert.match(await res.text(), /Handcrafted The Barbershop/);
});

test('returns 404 page for unknown routes', async () => {
  const res = await fetch(`${base}/does-not-exist`);
  assert.equal(res.status, 404);
  assert.match(await res.text(), /This chair is empty/);
});

test('blocks path traversal', async () => {
  const res = await fetch(`${base}/..%2fdev-server.js`);
  assert.notEqual(res.status, 200);
});

test('GET /api/status reports open state', async () => {
  const res = await fetch(`${base}/api/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(typeof body.isOpen, 'boolean');
  assert.match(body.label, /Open|Closed/);
});

test('POST /api/contact stores a valid message', async () => {
  const res = await post({ name: 'John', contact: 'john@example.com', service: 'Kids\' Cut', message: 'Can you fit 3 kids on Saturday?' });
  assert.equal(res.status, 201);
  const saved = (await readFile(path.join(dataDir, 'messages.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(saved.at(-1).name, 'John');

  const list = await fetch(`${base}/api/messages`, { headers: { Authorization: 'Bearer secret' } });
  assert.equal(list.status, 200);
  assert.equal((await list.json()).messages[0].name, 'John');
});

test('POST /api/contact rejects invalid input', async () => {
  const res = await post({ name: '', contact: 'x', message: '' });
  assert.equal(res.status, 422);
  assert.ok((await res.json()).errors.name);
});

test('POST /api/contact requires JSON and rejects bad JSON', async () => {
  assert.equal((await post('name=x', { 'Content-Type': 'application/x-www-form-urlencoded' })).status, 415);
  assert.equal((await post('{nope')).status, 400);
});

test('honeypot submissions are silently dropped', async () => {
  const res = await post({ name: 'Bot', contact: 'bot@spam.com', message: 'Buy now!!!', website: 'http://spam' });
  assert.equal(res.status, 200);
});

test('/api/messages requires the admin token', async () => {
  assert.equal((await fetch(`${base}/api/messages`)).status, 401);
});

test('rate limits repeated submissions', async () => {
  let last;
  for (let i = 0; i < 6; i++) last = await post({ name: 'Spammy', contact: 'a@b.co', message: 'hello again' });
  assert.equal(last.status, 429);
});
