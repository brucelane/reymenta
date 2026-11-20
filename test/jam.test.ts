// The Jam (2026-11-20): jam.json validation, pads over the scale, notes held / shared / capped, Link quantize, knobs
// averaged, clips only when switched on, the phone messages. src/jam, src/room/protocol.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { padNote, rootOf, validateJam, type JamConfig } from '../src/jam/config';
import { Jam, type MidiMsg } from '../src/jam/jam';
import { parsePhoneMessage } from '../src/room/protocol';

const RAW = {
  port: 'loopMIDI Jam', root: 'A', mode: 'minorPenta', quantize: 0.25, clipChannel: 16,
  tracks: [
    { name: 'Drums', kind: 'drums', channel: 10, pads: [{ name: 'Kick', note: 36 }, { name: 'Snare', note: 38 }], clips: [{ name: 'A', note: 0 }, { name: 'B', note: 1, on: false }] },
    { name: 'Bass', kind: 'notes', channel: 1, octave: 1, octaves: 2, voices: 1, knobs: [{ name: 'Cutoff', cc: 74 }] },
    { name: 'Pad', kind: 'notes', channel: 2, octave: 3, voices: 2 },
    { name: 'Delay', kind: 'fx', knobs: [{ name: 'Feedback', cc: 22, channel: 15, max: 100 }] },
  ],
};
const cfg = (): JamConfig => { const v = validateJam(structuredClone(RAW)); assert.equal(typeof v, 'object'); return v as JamConfig; };

function setup(o: { link?: { beat: number; bpm: number } } = {}) {
  let now = 1000;
  const sent: Array<{ msgs: MidiMsg[]; delay: number }> = [];
  const link = o.link;
  const jam = new Jam(cfg(), (msgs, delay) => sent.push({ msgs, delay }), () => (link ? { ...link, playing: true } : undefined), () => now, true);
  return { jam, sent, advance: (ms: number) => { now += ms; }, link };
}

test('jam.json: the example in assets is valid; errors are explained', () => {
  const file = join(import.meta.dirname, '..', '..', 'assets', 'jam', 'jam.json');
  const v = validateJam(JSON.parse(readFileSync(file, 'utf8')));
  assert.equal(typeof v, 'object', String(v));
  assert.match(String(validateJam({ ...RAW, port: '' })), /port/);
  assert.match(String(validateJam({ ...RAW, root: 'H' })), /root/);
  assert.match(String(validateJam({ ...RAW, mode: 'lydianish' })), /mode/);
  assert.match(String(validateJam({ ...RAW, tracks: [{ kind: 'fx' }] })), /knobs/);
  const c = cfg();
  assert.equal(c.root, 9);
  assert.equal(c.tracks[3].knobs[0].max, 100);
  assert.equal(c.tracks[2].octaves, 2);
  assert.deepEqual([rootOf('Bb'), rootOf('f#'), rootOf('C'), rootOf('x')], [10, 6, 0, undefined]);
});

test('pads: the scale from the lowest root, octaves + the top root', () => {
  const bass = { octave: 1, octaves: 2 };
  // A minor pentatonic from A1 (33): A C D E G A ...
  assert.deepEqual([0, 1, 2, 3, 4, 5, 10].map((p) => padNote(bass, 9, 'minorPenta', p)), [33, 36, 38, 40, 43, 45, 57]);
  assert.equal(padNote(bass, 9, 'minorPenta', 11), undefined);
});

test('notes: on while held, off on release, shared by phones, capped by voices; without Link at once', () => {
  const { jam, sent } = setup();
  jam.join('a'); jam.join('b');
  jam.pick('a', 2); jam.pick('b', 2);
  jam.pad('a', 0, true); // A3 = 57
  jam.pad('b', 0, true); // the same note: no second note on
  assert.deepEqual(sent.map((s) => s.msgs[0]), [{ type: 'noteon', channel: 2, note: 57, velocity: 100 }]);
  assert.equal(sent[0].delay, 0);
  jam.pad('a', 1, true); // C4 = 60: second voice
  jam.pad('b', 2, true); // a third note: the track holds 2 voices at most
  assert.equal(sent.length, 2);
  jam.pad('a', 0, false); // b still holds A3
  assert.equal(sent.length, 2);
  jam.pad('b', 0, false);
  assert.deepEqual(sent[2].msgs[0], { type: 'noteoff', channel: 2, note: 57 });
  // a phone leaving releases its notes
  jam.leave('a');
  assert.deepEqual(sent[3].msgs[0], { type: 'noteoff', channel: 2, note: 60 });
  // drums: pad index -> its note, a velocity from the phone
  jam.pick('b', 0);
  jam.pad('b', 1, true, 0.5);
  assert.deepEqual(sent[4].msgs[0], { type: 'noteon', channel: 10, note: 38, velocity: 64 });
  // closed: nothing plays, held notes end
  jam.setOpen(false);
  assert.deepEqual(sent[5].msgs[0], { type: 'noteoff', channel: 10, note: 38 });
  jam.pad('b', 0, true);
  assert.equal(sent.length, 6);
});

test('quantize on the Link beat: a note waits for the next sixteenth', () => {
  const { jam, sent } = setup({ link: { beat: 10.1, bpm: 120 } });
  jam.join('a'); jam.pick('a', 1);
  jam.pad('a', 0, true);
  // next sixteenth: 10.25, 0.15 beat at 120 bpm = 75 ms
  assert.ok(Math.abs(sent[0].delay - 75) < 1e-6, String(sent[0].delay));
  jam.pad('a', 0, false);
  assert.ok(sent[1].delay > sent[0].delay); // the note off after its note on
  assert.equal(jam.state().link, true);
  assert.deepEqual(jam.beat(), { t: 'jbeat', b: 10.1, bpm: 120, p: 1 });
});

test('knobs: averaged over the phones moving them, sent when the value changes, scaled to min..max', () => {
  const { jam, sent, advance } = setup();
  jam.join('a'); jam.join('b'); jam.join('c');
  jam.pick('a', 3); jam.pick('b', 3); jam.pick('c', 1);
  jam.knob('a', 0, 1); jam.knob('b', 0, 0.5);
  jam.knob('c', 5, 1); // no such knob: ignored
  jam.tick();
  assert.deepEqual(sent[0].msgs, [{ type: 'cc', channel: 15, controller: 22, value: 75 }]); // 0.75 of 0..100
  jam.tick();
  assert.equal(sent.length, 1); // unchanged: not sent again
  advance(16000); // a's and b's moves are old: the last average stays
  jam.knob('a', 0, 0);
  jam.tick();
  assert.deepEqual(sent[1].msgs, [{ type: 'cc', channel: 15, controller: 22, value: 0 }]);
  assert.deepEqual(jam.state('a').tracks[3].kv, [0]);
});

test('clips: only those switched on, a cooldown per phone, a short note on the clip channel', () => {
  const { jam, sent, advance } = setup();
  jam.join('a'); jam.pick('a', 0);
  assert.equal(jam.clip('a', 1), false); // B is off
  assert.equal(jam.clip('a', 0), true);
  assert.deepEqual(sent.map((s) => [s.msgs[0], s.delay]), [[{ type: 'noteon', channel: 16, note: 0, velocity: 127 }, 0], [{ type: 'noteoff', channel: 16, note: 0 }, 100]]);
  assert.equal(jam.clip('a', 0), false); // too soon
  advance(2100);
  assert.equal(jam.setClip(0, 1, true), true);
  assert.equal(jam.clip('a', 1), true);
  assert.deepEqual(jam.state('a').tracks[0].clips, [[0, 'A'], [1, 'B']]);
  assert.equal(jam.setClip(0, 9, true), false);
});

test('state: tracks, players, scale; the organiser changes the scale (held notes end)', () => {
  const { jam, sent } = setup();
  jam.join('a'); jam.pick('a', 1);
  jam.pad('a', 0, true);
  const st = jam.state('a');
  assert.equal(st.mine, 1);
  assert.deepEqual(st.steps, [0, 3, 5, 7, 10]);
  assert.equal(st.tracks[1].p, 1);
  assert.equal(st.tracks[1].pads.length, 11);
  assert.equal(st.tracks[1].base, 33);
  assert.deepEqual(st.tracks[0].pads, ['Kick', 'Snare']);
  assert.equal(jam.setScale(4, 'dorian'), true);
  assert.deepEqual(sent[1].msgs[0], { type: 'noteoff', channel: 1, note: 33 });
  assert.equal(jam.state().tracks[1].base, 28);
  assert.equal(jam.setScale(4, 'nope'), false);
  assert.equal(jam.pick('a', 9), false);
});

test('phone messages: jam, track, pad, knob, clip validated', () => {
  assert.deepEqual(parsePhoneMessage('{"t":"jam","on":true}'), { t: 'jam', on: true });
  assert.deepEqual(parsePhoneMessage('{"t":"jt","k":-1}'), { t: 'jt', k: -1 });
  assert.deepEqual(parsePhoneMessage('{"t":"jn","p":3,"on":1,"v":0.7}'), { t: 'jn', p: 3, on: 1, v: 0.7 });
  assert.deepEqual(parsePhoneMessage('{"t":"jn","p":3,"on":0}'), { t: 'jn', p: 3, on: 0 });
  assert.deepEqual(parsePhoneMessage('{"t":"jk","k":1,"v":2}'), { t: 'jk', k: 1, v: 1 });
  assert.deepEqual(parsePhoneMessage('{"t":"jc","c":2}'), { t: 'jc', c: 2 });
  for (const bad of ['{"t":"jn","p":-1,"on":1}', '{"t":"jn","p":1.5,"on":1}', '{"t":"jn","p":1,"on":true}', '{"t":"jt","k":"x"}', '{"t":"jk","k":9,"v":0}', '{"t":"jc","c":99}']) {
    assert.equal(parsePhoneMessage(bad), undefined, bad);
  }
});
