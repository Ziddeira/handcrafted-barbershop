// Where contact-form messages are kept.
//  - Redis over REST (Upstash / Vercel Marketplace) when its env vars are set — works on Vercel.
//  - A local JSONL file otherwise, except on Vercel, whose filesystem is read-only.

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = 'contact:messages';
const MAX_KEPT = 1000;
const DEFAULT_DATA_DIR = fileURLToPath(new URL('../data', import.meta.url));

export function redisStore(url, token) {
  async function command(...args) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new Error(`Redis responded ${res.status}`);
    return (await res.json()).result;
  }

  return {
    kind: 'redis',
    async add(entry) {
      await command('LPUSH', KEY, JSON.stringify(entry));
      await command('LTRIM', KEY, 0, MAX_KEPT - 1);
    },
    async list() {
      return (await command('LRANGE', KEY, 0, 199)).map((item) => JSON.parse(item));
    },
  };
}

export function fileStore(dataDir = DEFAULT_DATA_DIR) {
  const file = path.join(dataDir, 'messages.jsonl');
  return {
    kind: 'file',
    async add(entry) {
      await mkdir(dataDir, { recursive: true });
      await appendFile(file, JSON.stringify(entry) + '\n');
    },
    async list() {
      let raw = '';
      try {
        raw = await readFile(file, 'utf8');
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
      return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line)).reverse();
    },
  };
}

/** Picks a store from the environment, or null when nothing persistent is available. */
export function storeFromEnv(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return redisStore(url, token);
  if (!env.VERCEL) return fileStore(env.DATA_DIR || DEFAULT_DATA_DIR);
  return null;
}
