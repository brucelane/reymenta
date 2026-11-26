// The online Jam (2026-11-26): the shared beat grid (dueAt), peer messages validated, two pages wired through a fake
// group hear the same notes at the same time, presence counts and the 5-player cap, knobs, and api/jamjoin
// (closed during the show's window, a token for the room's group only). web/src/jam/online, api/jamjoin.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import type { MidiMsg } from '../src/jam/jam';
import { stripTempo } from '../web/src/jam/online/starters';
import { dueAt, FLOOD_MAX, MAX_CODE, MAX_PLAYERS, MIN_AHEAD_MS, newPlayerId, newRoomCode, SEND_BURST, toNextBar, toWire, OnlineRoom, onlineConfig, parsePeerMessage, PRESENCE_TIMEOUT_MS, ROOM_RE, type PeerMessage } from '../web/src/jam/online/onlineRoom';

const require = createRequire(import.meta.url);
const jamjoin = require('../api/jamjoin/index.js');

test('dueAt: on the grid, at least MIN_AHEAD_MS ahead', () => {
  const grid = 136;
  // the next line is 40 ms away: two lines later (40 + 136 = 176 >= 150)
  assert.equal(dueAt(1000, 40, grid), 1176);
  // already far enough
  assert.equal(dueAt(1000, 160, grid), 1160);
  // a knob (no delay, no grid): just ahead
  assert.equal(dueAt(1000, 0, 0), 1000 + MIN_AHEAD_MS);
});

test('peer messages: validated, sender from Web PubSub, times near now only', () => {
  const now = 1_000_000;
  const id = 'abcdefgh12';
  assert.equal(parsePeerMessage({ t: 'p', tr: 1 }, 'bad id!', now), undefined);
  assert.equal(parsePeerMessage({ t: 'p', tr: 1 }, undefined, now), undefined);
  assert.deepEqual(parsePeerMessage({ t: 'p', tr: 99, ro: 7, nm: 'x' + String.fromCharCode(0) + 'y', hue: 999 }, id, now), { t: 'p', id, tr: -1, ro: 'music', nm: 'xy', hue: 220 });
  assert.equal(parsePeerMessage({ t: 'm', at: now + 60_000, m: [[0, 1, 40, 100]] }, id, now), undefined);
  assert.equal(parsePeerMessage({ t: 'm', at: now, m: [[7, 1, 40, 100]] }, id, now), undefined);
  const msgs: MidiMsg[] = [{ type: 'noteon', channel: 1, note: 40, velocity: 90 }, { type: 'noteoff', channel: 1, note: 40 }, { type: 'cc', channel: 16, controller: 91, value: 64 }];
  const wire = toWire({ t: 'm', id, at: now + 200.4, msgs });
  assert.deepEqual(wire, { t: 'm', at: now + 200, m: [[0, 1, 40, 90], [1, 1, 40], [2, 16, 91, 64]] });
  assert.deepEqual(parsePeerMessage(JSON.parse(JSON.stringify(wire)), id, now), { t: 'm', id, at: now + 200, msgs });
  assert.ok(JSON.stringify(wire).length < 80, 'short on the wire');
  assert.match(newRoomCode(), ROOM_RE);
  assert.match(newPlayerId(), /^[a-z2-9]{10}$/);
});

/** pages on a fake group: what one sends, the others receive (noEcho) */
function wire(n: number, clock: { t: number }) {
  const heard: Array<Array<{ msgs: MidiMsg[]; at: number }>> = [];
  const rooms: OnlineRoom[] = [];
  for (let i = 0; i < n; i++) {
    heard.push([]);
    const id = `player${i}abc`;
    rooms.push(new OnlineRoom({ id, name: `P${i}`, hue: i * 40 }, () => clock.t,
      (m: PeerMessage) => rooms.forEach((r, j) => { if (j !== i) { const p = parsePeerMessage(JSON.parse(JSON.stringify(toWire(m))), rooms[i].me.id, clock.t); if (p) r.receive(p); } }),
      (msgs, at) => heard[i].push({ msgs, at })));
  }
  return { rooms, heard };
}

test('two pages: the same note at the same time on both', () => {
  const clock = { t: 10_000_000 };
  const { rooms: [a, b], heard } = wire(2, clock);
  b.input({ t: 'jt', k: 0 });
  assert.equal(a.input({ t: 'jt', k: 1 }), true); // Bass
  a.input({ t: 'jn', p: 0, on: 1 });
  assert.equal(heard[0].length, 1);
  assert.deepEqual(heard[1], heard[0]); // B plays exactly what A plays, at the same time
  const { msgs, at } = heard[0][0];
  assert.deepEqual(msgs, [{ type: 'noteon', channel: 1, note: 33, velocity: 100 }]); // A1, the bass's root
  assert.ok(at - clock.t >= MIN_AHEAD_MS);
  const grid = a.gridMs;
  assert.ok(Math.abs(Math.round(at / grid) * grid - at) <= 0.5, 'on the shared sixteenth grid (to the ms)');
  clock.t += 300;
  a.input({ t: 'jn', p: 0, on: 0 });
  assert.equal(heard[1].at(-1)!.msgs[0].type, 'noteoff');
  assert.ok(heard[1].at(-1)!.at > at);
  // presence: each sees the other on its track
  assert.deepEqual(a.state().tracks.map((t) => t.p), [1, 1, 0, 0, 0]);
  assert.deepEqual(b.state().tracks.map((t) => t.p), [1, 1, 0, 0, 0]);
  // a knob: sent on the next tick, as a CC on the track's channel
  a.input({ t: 'jk', k: 0, v: 1 });
  a.tick();
  assert.deepEqual(heard[1].at(-1)!.msgs, [{ type: 'cc', channel: 1, controller: 74, value: 127 }]);
  // leaving: B forgets A
  a.leave();
  assert.equal(b.others().length, 0);
});

test('presence: the cap, and quiet players dropped', () => {
  const clock = { t: 5_000_000 };
  const { rooms } = wire(MAX_PLAYERS + 1, clock);
  rooms.forEach((r) => r.input({ t: 'jt', k: -1 })); // everyone says hello
  assert.equal(rooms[0].others().length, MAX_PLAYERS);
  assert.equal(rooms[0].full, true); // a sixth page sees five others: it leaves
  clock.t += PRESENCE_TIMEOUT_MS + 1;
  assert.equal(rooms[0].others().length, 0);
});

test('the online config: drums, bass, keys, lead, space', () => {
  const c = onlineConfig();
  assert.deepEqual(c.tracks.map((t) => [t.name, t.kind, t.channel]), [['Drums', 'drums', 10], ['Bass', 'notes', 1], ['Keys', 'notes', 2], ['Lead', 'notes', 3], ['Space', 'fx', 16]]);
});

test('api/jamjoin: closed in the show window, a token for one group', async () => {
  const from = '2026-12-18T17:30:00+01:00', until = '2026-12-18T23:00:00+01:00';
  assert.equal(jamjoin.onlineOpen({ SHOW_OPEN_FROM: from, SHOW_OPEN_UNTIL: until }, Date.parse('2026-12-18T19:00:00+01:00')), false);
  assert.equal(jamjoin.onlineOpen({ SHOW_OPEN_FROM: from, SHOW_OPEN_UNTIL: until }, Date.parse('2026-12-19T10:00:00+01:00')), true);
  assert.equal(jamjoin.onlineOpen({ JAM_ONLINE: 'off' }, Date.now()), false);
  assert.equal(jamjoin.onlineOpen({}, Date.now()), true);

  const saved = { ...process.env };
  try {
    process.env.PUBSUB_CONNECTION_STRING = 'Endpoint=https://example.webpubsub.azure.com;AccessKey=c2VjcmV0;Version=1.0;';
    delete process.env.SHOW_OPEN_FROM; delete process.env.SHOW_OPEN_UNTIL; delete process.env.JAM_ONLINE;
    const call = async (query: Record<string, string>) => { const ctx: { res?: { status: number; body: Record<string, unknown> } } = {}; await jamjoin(ctx, { query, headers: {} }); return ctx.res!; };
    assert.equal((await call({ id: 'abcdefgh1', room: 'x' })).status, 400);
    const r = await call({ id: 'abcdefgh1', room: 'Abc12' });
    assert.equal(r.status, 200);
    assert.equal(r.body.group, 'jam-abc12');
    assert.equal(typeof r.body.now, 'number');
    const token = String(r.body.url).split('access_token=')[1];
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    assert.deepEqual(payload.role, ['webpubsub.sendToGroup.jam-abc12', 'webpubsub.joinLeaveGroup.jam-abc12']);
    assert.equal(payload.exp - payload.iat, 3600);
    assert.match(String(r.body.url), /^wss:\/\/example\.webpubsub\.azure\.com\/client\/hubs\/jamonline\?/);
  } finally {
    process.env = saved;
  }
});

test('a page sends at most its budget; note offs always go', () => {
  const clock = { t: 20_000_000 };
  const { rooms: [a, b], heard } = wire(2, clock);
  a.input({ t: 'jt', k: 0 }); // drums: one-shot pads
  for (let i = 0; i < 100; i++) { a.input({ t: 'jn', p: i % 6, on: 1 }); a.input({ t: 'jn', p: i % 6, on: 0 }); }
  const ons = heard[0].filter((h) => h.msgs.some((m) => m.type === 'noteon')).length;
  assert.ok(ons > 0 && ons <= SEND_BURST / 2 + 1, `${ons} notes on`); // note offs use the budget too; the rest dropped, here too
  // so many messages at once: the other page muted this one
  assert.equal(b.muted.has(a.me.id), true);
  // a second later the budget is back
  clock.t += 1000;
  a.input({ t: 'jn', p: 0, on: 1 });
  assert.equal(heard[0].at(-1)!.msgs[0].type, 'noteon');
});

test('a flooding peer is muted; its note offs still end its notes', () => {
  const clock = { t: 30_000_000 };
  const heard: Array<{ msgs: MidiMsg[] }> = [];
  const b = new OnlineRoom({ id: 'listener01', name: 'B', hue: 0 }, () => clock.t, () => {}, (msgs) => heard.push({ msgs }));
  const flood = (type: 'noteon' | 'noteoff') => b.receive({ t: 'm', id: 'flooder01', at: clock.t + 200, msgs: [type === 'noteon' ? { type, channel: 2, note: 60, velocity: 100 } : { type, channel: 2, note: 60 }] });
  for (let i = 0; i < FLOOD_MAX; i++) flood('noteon');
  assert.equal(b.muted.has('flooder01'), false);
  assert.equal(flood('noteon'), true); // one too many: muted, the screen redraws
  assert.equal(b.muted.has('flooder01'), true);
  const n = heard.length;
  flood('noteon');
  assert.equal(heard.length, n); // nothing new plays
  flood('noteoff');
  assert.equal(heard.length, n + 1); // but its note offs do
});

test('api/jamjoin: closed the whole show day (from 00:00 UTC), no token into it, tokens per address', () => {
  const env = { SHOW_OPEN_FROM: '2026-12-18T17:30:00+01:00', SHOW_OPEN_UNTIL: '2026-12-18T23:00:00+01:00' };
  assert.equal(jamjoin.onlineOpen(env, Date.parse('2026-12-18T00:30:00Z')), false); // 01:30 in Valbonne, the quota's new day
  assert.equal(jamjoin.onlineOpen(env, Date.parse('2026-12-17T23:30:00Z')), true);
  // a token taken at 23:30 UTC the day before ends at 00:00 UTC, not an hour later
  assert.equal(jamjoin.tokenEnd(env, Date.parse('2026-12-17T23:30:00Z')), Date.parse('2026-12-18T00:00:00Z'));
  assert.equal(jamjoin.tokenEnd({}, 1000), 1000 + 3600_000);
  const t = 50_000_000;
  for (let i = 0; i < 6; i++) assert.equal(jamjoin.ipAllowed('203.0.113.9', t + i), true);
  assert.equal(jamjoin.ipAllowed('203.0.113.9', t + 10), false);
  assert.equal(jamjoin.ipAllowed('203.0.113.10', t + 10), true);
  assert.equal(jamjoin.ipAllowed('203.0.113.9', t + 11 * 60_000), true); // the window passed
});

test('roles and code: Hydra (the latest wins), Strudel parts, newcomers greeted, limits', () => {
  const clock = { t: 40_000_000 };
  const { rooms: [a, b, c] } = wire(3, clock);
  [a, b, c].forEach((r) => r.input({ t: 'jt', k: -1 }));
  a.setRole('visuals');
  b.setRole('strudel');
  assert.equal(c.peers.get(a.me.id)!.role, 'visuals');
  assert.equal(c.peers.get(b.me.id)!.role, 'strudel');
  // presence round-trips the role on the wire
  assert.deepEqual(toWire(a.presence()), { t: 'p', tr: -1, ro: 1, nm: 'P0', hue: 0 });

  assert.equal(a.shareCode('h', 'osc().out()'), 'ok');
  assert.equal(c.hydra!.code, 'osc().out()');
  assert.equal(a.shareCode('h', 'noise().out()'), 'wait'); // the cooldown
  clock.t += 2500;
  assert.equal(c.shareCode('h', 'shape(4).out()'), 'ok'); // a later one wins everywhere
  assert.equal(a.hydra!.code, 'shape(4).out()');
  assert.equal(b.hydra!.code, 'shape(4).out()');
  assert.equal(a.shareCode('h', 'x'.repeat(MAX_CODE + 1)), 'long');

  b.shareCode('s', '$: s("bd*4")');
  clock.t += 2500;
  c.shareCode('s', '$: s("hh*8")');
  // every page has both parts, in the same order
  assert.equal(a.strudelProgram(), b.strudelProgram());
  assert.equal(a.strudel.size, 2);
  // a part removed with ""
  clock.t += 2500;
  c.shareCode('s', '');
  assert.equal(a.strudel.size, 1);
  // a newcomer gets the code from its authors' greetings
  const late = new OnlineRoom({ id: 'latecomer1', name: 'L', hue: 1 }, () => clock.t, () => {}, () => {});
  for (const author of [a, b, c]) {
    const sent: PeerMessage[] = [];
    const greeter = Object.create(author) as OnlineRoom;
    (greeter as unknown as { send: (m: PeerMessage) => void }).send = (m) => sent.push(m);
    greeter.greet();
    sent.forEach((m) => late.receive(parsePeerMessage(JSON.parse(JSON.stringify(toWire(m))), author.me.id, clock.t)!));
  }
  assert.equal(late.hydra!.code, 'shape(4).out()');
  assert.equal(late.strudelProgram(), a.strudelProgram());
  // a player leaving takes its part with it
  b.leave();
  assert.equal(a.strudel.size, 0);
});

test('code from a peer: validated', () => {
  const now = 1_000_000;
  assert.deepEqual(parsePeerMessage({ t: 'c', k: 'h', v: now, code: 'osc().out()' }, 'abcdefgh12', now), { t: 'c', id: 'abcdefgh12', k: 'h', v: now, code: 'osc().out()' });
  assert.equal(parsePeerMessage({ t: 'c', k: 'x', v: now, code: '' }, 'abcdefgh12', now), undefined);
  assert.equal(parsePeerMessage({ t: 'c', k: 's', v: now, code: 'x'.repeat(MAX_CODE + 1) }, 'abcdefgh12', now), undefined);
  assert.equal(parsePeerMessage({ t: 'c', k: 's', v: now + 60_000, code: '' }, 'abcdefgh12', now), undefined); // from the future
  assert.equal(toNextBar(0, 120), 2000);
  assert.equal(toNextBar(500, 120), 1500);
  assert.equal(stripTempo('setcps(0.5)\n$: s("bd")\n  setcpm(30)'), '$: s("bd")');
});
