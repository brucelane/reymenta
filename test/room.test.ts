import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gridSize, layout } from '../src/room/layout';
import { nameFor } from '../src/room/names';
import { parsePhoneMessage } from '../src/room/protocol';
import { AUD, Room, TIMEOUT_MS } from '../src/room/room';

test('grid sizes follow 1 / row of 3 / 3x3 / 4x4', () => {
  assert.deepEqual(gridSize(1), { cols: 1, rows: 1 });
  assert.deepEqual(gridSize(3), { cols: 3, rows: 1 });
  assert.deepEqual(gridSize(4), { cols: 3, rows: 2 });
  assert.deepEqual(gridSize(9), { cols: 3, rows: 3 });
  assert.deepEqual(gridSize(10), { cols: 4, rows: 3 });
  assert.deepEqual(gridSize(16), { cols: 4, rows: 4 });
});

test('one circle is centered, the last row is centered', () => {
  assert.deepEqual(layout(1), [{ x: 0.5, y: 0.5 }]);
  const four = layout(4); // 3 on top, 1 centered below
  assert.equal(four[3].x, 0.5);
  assert.ok(four[3].y > four[0].y);
});

test('names are stable and exist in both languages', () => {
  const a = nameFor('abcdefgh-1234');
  assert.deepEqual(nameFor('abcdefgh-1234'), a);
  assert.ok(a.fr.length > 3 && a.en.length > 3);
});

test('phone messages are validated and clamped', () => {
  assert.equal(parsePhoneMessage('not json'), undefined);
  assert.equal(parsePhoneMessage(JSON.stringify({ t: 'hello', id: 'x' })), undefined); // id too short
  assert.equal(parsePhoneMessage(JSON.stringify({ t: 'command', command: 'mio_1' })), undefined);
  assert.deepEqual(parsePhoneMessage(JSON.stringify({ t: 'in', tx: 5, sh: -1, to: 1 })), { t: 'in', tx: 1, sh: 0, to: 1 });
  assert.equal(parsePhoneMessage(JSON.stringify({ t: 'emo', e: 99 })), undefined);
});

test('room: join, aggregates, emoji rate, timeout', () => {
  const room = new Room();
  const out = room.receive('phone-aaaaaaaa', { t: 'hello', id: 'phone-aaaaaaaa', lang: 'fr' }, 0);
  assert.equal(out[0].msg.t, 'welcome');
  room.receive('phone-bbbbbbbb', { t: 'hello', id: 'phone-bbbbbbbb', lang: 'en' }, 0);
  room.receive('phone-aaaaaaaa', { t: 'in', tx: 1, to: 1, px: 0.2, py: 0.4 }, 100);
  room.receive('phone-bbbbbbbb', { t: 'in', tx: 0, sh: 0.5 }, 100);
  let v = room.aggregates(200);
  assert.equal(v[AUD.count], 2 / 64);
  assert.equal(v[AUD.tiltX], 0.75); // average tilt 0.5 -> 0.75
  assert.equal(v[AUD.shake], 0.25);
  assert.equal(v[AUD.touch], 0.5);
  assert.equal(v[AUD.fingerX], 0.2);
  // emoji: the second one within 1.5 s is ignored
  room.receive('phone-aaaaaaaa', { t: 'emo', e: 0 }, 1000);
  room.receive('phone-aaaaaaaa', { t: 'emo', e: 0 }, 1500);
  v = room.aggregates(1600);
  assert.equal(v[AUD.fire], 1 / 12);
  // b keeps talking, a goes silent and leaves
  room.receive('phone-bbbbbbbb', { t: 'hb' }, TIMEOUT_MS + 1000);
  const updates = room.prune(TIMEOUT_MS + 2000); // a was last seen at 1500
  assert.equal(room.count, 1);
  assert.equal(updates[0].msg.t, 'place');
  // the dropped phone keeps talking: asked to rejoin, at most every 3 s
  const now = TIMEOUT_MS + 3000;
  assert.deepEqual(room.receive('phone-aaaaaaaa', { t: 'hb' }, now), [{ id: 'phone-aaaaaaaa', msg: { t: 'rejoin' } }]);
  assert.deepEqual(room.receive('phone-aaaaaaaa', { t: 'in', tx: 0.1 }, now + 100), []);
  assert.equal(room.receive('phone-aaaaaaaa', { t: 'hello', id: 'phone-aaaaaaaa', lang: 'fr' }, now + 200)[0].msg.t, 'welcome');
});

test('each of the first phones gets its own look in iAud16..31 (finger while touching, else tilt)', () => {
  const room = new Room();
  room.receive('a', { t: 'hello', lang: 'fr' } as never, 0);
  room.receive('b', { t: 'hello', lang: 'en' } as never, 0);
  room.receive('a', { t: 'in', tx: 1, ty: -1 }, 10);
  room.receive('b', { t: 'in', to: 1, px: 0.2, py: 0.9 }, 10);
  const v = room.aggregates(20);
  assert.deepEqual([v[AUD.look], v[AUD.look + 1]], [1, 0]);
  assert.deepEqual([v[AUD.look + 2], v[AUD.look + 3]], [0.2, 0.9]);
  assert.equal(v[AUD.look + 4], 0.5, 'nobody in slot 3: straight ahead');
});
