// The gate on /api/join (api/join/index.js, studies/show-access.md): window, code, room, token expiry.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const join = require('../api/join/index.js');

const KEY = Buffer.from('test-key-0123456789').toString('base64');
const BASE = {
  PUBSUB_CONNECTION_STRING: `Endpoint=https://x.webpubsub.azure.com;AccessKey=${KEY};Version=1.0;`,
  SHOW_CODE: 'Lune42',
  SHOW_ROOM: 'reymenta',
};

async function call(env: Record<string, string>, query: Record<string, string>, origin = 'https://live.videodromm.com') {
  const saved = { ...process.env };
  for (const k of ['PUBSUB_CONNECTION_STRING', 'SHOW_CODE', 'SHOW_ROOM', 'SHOW_OPEN_FROM', 'SHOW_OPEN_UNTIL', 'SHOW_FORCE', 'JOIN_ORIGINS', 'TURNSTILE_SECRET', 'TURNSTILE_SOFT']) delete process.env[k];
  Object.assign(process.env, env);
  const ctx: { res?: { status: number; headers: Record<string, string>; body: any } } = {};
  try {
    await join(ctx, { query, headers: { origin } });
  } finally {
    process.env = saved;
  }
  return ctx.res!;
}

const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

test('join: closed without a window, open inside it, closed after', async () => {
  const q = { id: 'phone-abc-123', k: 'lune42' };
  assert.equal((await call(BASE, q)).status, 403);
  const before = await call({ ...BASE, SHOW_OPEN_FROM: iso(3600e3), SHOW_OPEN_UNTIL: iso(7200e3) }, q);
  assert.equal(before.status, 403);
  assert.equal(before.body.closed, true);
  assert.ok(before.body.opensAt);
  const inside = await call({ ...BASE, SHOW_OPEN_FROM: iso(-60e3), SHOW_OPEN_UNTIL: iso(1800e3) }, q);
  assert.equal(inside.status, 200);
  assert.match(inside.body.url, /^wss:\/\/x\.webpubsub\.azure\.com\/client\/hubs\/reymenta\?access_token=/);
  // the token ends with the window, not 3 hours later
  assert.ok(Math.abs(Date.parse(inside.body.until) - (Date.now() + 1800e3)) < 5e3);
  assert.equal((await call({ ...BASE, SHOW_OPEN_FROM: iso(-7200e3), SHOW_OPEN_UNTIL: iso(-60e3) }, q)).status, 403);
});

test('join: the code is required, compared without case or spaces', async () => {
  const open = { ...BASE, SHOW_FORCE: 'open' };
  assert.equal((await call(open, { id: 'phone-abc-123' })).body.code, true);
  assert.equal((await call(open, { id: 'phone-abc-123', k: 'lune43' })).body.code, true);
  assert.equal((await call(open, { id: 'phone-abc-123', k: ' LUNE 42 ' })).status, 200);
});

test('join: only the show room; forced closed wins; not configured without a code', async () => {
  const open = { ...BASE, SHOW_FORCE: 'open' };
  assert.equal((await call(open, { id: 'phone-abc-123', k: 'lune42', room: 'other' })).status, 403);
  assert.equal((await call({ ...BASE, SHOW_FORCE: 'closed', SHOW_OPEN_FROM: iso(-60e3), SHOW_OPEN_UNTIL: iso(60e3) }, { id: 'phone-abc-123', k: 'lune42' })).status, 403);
  assert.equal((await call({ ...open, SHOW_CODE: '' }, { id: 'phone-abc-123', k: '' })).status, 503);
  assert.equal((await call(open, { id: 'x', k: 'lune42' })).status, 400);
});

test('join: CORS only for the page and the app', async () => {
  const open = { ...BASE, SHOW_FORCE: 'open' };
  const q = { id: 'phone-abc-123', k: 'lune42' };
  assert.equal((await call(open, q)).headers['access-control-allow-origin'], 'https://live.videodromm.com');
  assert.equal((await call(open, q, 'https://evil.example')).headers['access-control-allow-origin'], undefined);
  assert.equal((await call(open, q, 'capacitor://localhost')).headers['access-control-allow-origin'], 'capacitor://localhost');
});

test('join: Turnstile checked when its secret is set (Cloudflare mocked)', async () => {
  const open = { ...BASE, SHOW_FORCE: 'open', TURNSTILE_SECRET: 'secret' };
  const q = { id: 'phone-abc-123', k: 'lune42' };
  const realFetch = globalThis.fetch;
  let answer: 'yes' | 'no' | 'down' = 'yes';
  globalThis.fetch = (async () => {
    if (answer === 'down') throw new Error('unreachable');
    return new Response(JSON.stringify({ success: answer === 'yes' }), { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal((await call(open, q)).body.captcha, true); // no token at all
    assert.equal((await call(open, { ...q, t: 'tok' })).status, 200);
    answer = 'no';
    assert.equal((await call(open, { ...q, t: 'tok' })).body.captcha, true);
    answer = 'down';
    assert.equal((await call(open, { ...q, t: 'tok' })).status, 403);
    assert.equal((await call({ ...open, TURNSTILE_SOFT: '1' }, { ...q, t: 'tok' })).status, 200);
  } finally {
    globalThis.fetch = realFetch;
  }
});
