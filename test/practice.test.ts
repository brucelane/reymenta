// The tuner's pitch detection and the practice section's pure logic (2026-11-20): pitch.ts, practice.ts. The practice
// pattern is evaluated by Strudel in Node (as test/strudel.test.ts does).
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { test } from 'node:test';
import type { TabNote } from '../src/core/songGrid';
import { detectPitch, freqToMidi, keyName, midiToFreq, nearest, nearestString, sameNote, Smoother } from '../web/src/tuner/pitch';
import { clickMini, loopNotes, nowNext, position, practiceCode, Scorer, Stepper, type PracticeOpts } from '../web/src/workshop/practice';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === "@kabelsalat/web") return { url: "data:text/javascript,export class SalatRepl {}", shortCircuit: true };
  return next(s, c);
}`));
type NodeHap = { whole?: { begin: { valueOf(): number } }; value: Record<string, unknown>; hasOnset(): boolean };
let strudel: Promise<(code: string) => Promise<{ queryArc(a: number, b: number): NodeHap[] }>> | undefined;
function evaluator() {
  strudel ??= (async () => {
    const core = await import('@strudel/core');
    const mini = await import('@strudel/mini');
    const { transpiler } = await import('@strudel/transpiler');
    await core.evalScope(core, mini, { setcpm: () => {}, setcps: () => {} });
    return async (code: string) => {
      const { output } = transpiler(code, { wrapAsync: true, addReturn: true, emitMiniLocations: false });
      return (0, eval)(output);
    };
  })();
  return strudel;
}
async function haps(code: string, cycles: number) {
  const pat = await (await evaluator())(code);
  return pat.queryArc(0, cycles).filter((h) => h.whole && h.hasOnset()).map((h) => ({ begin: Math.round(h.whole!.begin.valueOf() * 1000) / 1000, value: h.value }));
}

// ---------------------------------------------------------------- pitch

/** a bass-like tone: fundamental + strong 2nd and 3rd harmonics (the 2nd louder than the fundamental) */
function tone(freq: number, sr = 48000, n = 4096, noise = 0.02): Float32Array {
  const b = new Float32Array(n);
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    b[i] = 0.25 * Math.sin(2 * Math.PI * freq * t) + 0.35 * Math.sin(2 * Math.PI * 2 * freq * t + 0.3) + 0.15 * Math.sin(2 * Math.PI * 3 * freq * t + 1) + noise * rnd();
  }
  return b;
}

test('pitch: bass and guitar strings found within 5 cents, no octave jump', () => {
  for (const key of [23, 26, 28, 33, 38, 43, 40, 45, 50, 55, 59, 64, 76]) { // low B ... high E 12th fret
    const f = midiToFreq(key);
    const p = detectPitch(tone(f), 48000);
    assert.ok(p, `no pitch for ${keyName(key)}`);
    const cents = (freqToMidi(p!.freq) - key) * 100;
    assert.ok(Math.abs(cents) < 5, `${keyName(key)}: ${cents.toFixed(1)} cents`);
    assert.ok(p!.clarity > 0.8, `${keyName(key)}: clarity ${p!.clarity}`);
  }
});

test('pitch: silence and noise give nothing', () => {
  assert.equal(detectPitch(new Float32Array(4096), 48000), undefined);
  let seed = 7;
  const noise = new Float32Array(4096).map(() => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1);
  const p = detectPitch(noise, 48000);
  assert.ok(!p || p.clarity < 0.8);
});

test('pitch: names, nearest note and string, A4 reference, octave tolerance, smoother', () => {
  assert.equal(keyName(28), 'E1');
  assert.equal(keyName(28, true), 'Mi1');
  assert.equal(keyName(61), 'C#4');
  const n = nearest(midiToFreq(33.2));
  assert.equal(n.key, 33);
  assert.ok(Math.abs(n.cents - 20) < 0.01);
  assert.ok(Math.abs(freqToMidi(432, 432) - 69) < 1e-9);
  const s = nearestString(midiToFreq(37.9), [28, 33, 38, 43]);
  assert.equal(s.index, 2);
  assert.ok(Math.abs(s.cents + 10) < 0.01);
  assert.ok(sameNote(40.3, 28) && sameNote(28, 28) && !sameNote(29, 28));
  const sm = new Smoother(5);
  assert.equal(sm.push(40), undefined);
  sm.push(40.1);
  assert.equal(sm.push(52), 40.1); // an octave jump in the middle doesn't win
  assert.equal(sm.push(undefined), undefined);
});

// ---------------------------------------------------------------- practice pattern

const PATCH = `setcpm(30)
stack(
  note("c2 e2").s("sawtooth").color("bass"),
  s("bd*4")
)`;
const opts = (o: Partial<PracticeOpts> = {}): PracticeOpts => ({ from: 0, bars: 1, rate: 1, countIn: 0, click: false, parts: 'all', bpb: 4, ...o });

test('practice code: parts (all, without the bass, the bass alone, click only)', async () => {
  const all = await haps(practiceCode(PATCH, opts(), 30), 1);
  assert.equal(all.length, 6);
  const nobass = await haps(practiceCode(PATCH, opts({ parts: 'nobass' }), 30), 1);
  assert.deepEqual(nobass.map((h) => h.value.s), ['bd', 'bd', 'bd', 'bd']);
  const bass = await haps(practiceCode(PATCH, opts({ parts: 'bass' }), 30), 1);
  assert.equal(bass.length, 2);
  assert.ok(bass.every((h) => h.value.color === 'bass'));
  const click = await haps(practiceCode(PATCH, opts({ parts: 'click', click: true }), 30), 1);
  assert.equal(click.length, 4);
  assert.ok(click.every((h) => h.value.s === 'sine'));
  assert.equal(click[0].value.note, 'a5');
});

test('practice code: a loop of bars, the count-in, the speed', async () => {
  // bars 1-2 (0-based) of a 4-bar riff, looped: c d c d ...
  const riff = 'note("<c2 d2 e2 f2>").color("bass")';
  const loop = await haps(practiceCode(riff, opts({ from: 1, bars: 2 }), 30), 4);
  assert.deepEqual(loop.map((h) => h.value.note), ['d2', 'e2', 'd2', 'e2']);
  // one bar of count-in: 4 clicks, then the loop starts at cycle 1
  const counted = await haps(practiceCode(riff, opts({ from: 1, bars: 2, countIn: 1 }), 30), 3);
  assert.deepEqual(counted.filter((h) => h.value.s === 'sine').map((h) => h.begin), [0, 0.25, 0.5, 0.75]);
  assert.deepEqual(counted.filter((h) => h.value.s !== 'sine').map((h) => [h.begin, h.value.note]), [[1, 'd2'], [2, 'e2']]);
  // half speed: a bar lasts two cycles
  const slow = await haps(practiceCode(riff, opts({ from: 0, bars: 4, rate: 0.5 }), 30), 4);
  assert.deepEqual(slow.map((h) => [h.begin, h.value.note]), [[0, 'c2'], [2, 'd2']]);
  // no patch: a click at the track's tempo
  const none = practiceCode(undefined, opts({ parts: 'click', click: true }), 35);
  assert.match(none, /^setcpm\(35\)\nsilence/);
  assert.equal((await haps(none, 1)).length, 4);
  // odd meter: eighths
  assert.equal(clickMini(7.5).split(' ').length, 15);
  assert.equal(clickMini(5), 'a5 e5 e5 e5 e5');
});

test('practice position: count-in, loop passes, speed', () => {
  const o = opts({ from: 8, bars: 2, countIn: 1, rate: 0.5 });
  assert.deepEqual(position(0, o), { bar: 8, countdown: 4, pass: 0 });
  assert.deepEqual(position(1.5, o), { bar: 8, countdown: 1, pass: 0 }); // 0.75 of the count-in bar
  assert.deepEqual(position(2, o), { bar: 8, pass: 0 });
  assert.deepEqual(position(4, o), { bar: 9, pass: 0 });
  assert.deepEqual(position(6, o), { bar: 8, pass: 1 });
  assert.deepEqual(position(7, o), { bar: 8.5, pass: 1 });
});

const note = (beat: number, key: number, string = 0, fret = 0, dur = 1): TabNote =>
  ({ beat, dur, key, playedKey: key, string, fret, finger: fret ? 1 : 0, fingerOverridden: false, stringOverridden: false });
const TAB = [note(0, 28), note(1, 30, 0, 2), note(2, 31, 0, 3), note(4, 33, 1, 0), note(5, 35, 1, 2), note(8, 40, 2, 2)];

test('practice: loop notes, now / next', () => {
  assert.deepEqual(loopNotes(TAB, { from: 1, bars: 1, bpb: 4 }).map((x) => x.i), [3, 4]);
  const nn = nowNext(TAB, 1.5);
  assert.equal(nn.now?.i, 1);
  assert.equal(nn.next?.i, 2);
  assert.equal(nowNext(TAB, 3.5).now, undefined); // after the note's end: nothing sounding
  assert.equal(nowNext(TAB, 3.5).next?.i, 3);
});

test('practice listen: hits, misses, octave tolerance, missed bars, sections', () => {
  const o = { from: 0, bars: 2, bpb: 4 };
  const sc = new Scorer(loopNotes(TAB, o), o, 2, (b) => (b < 4 ? 'A' : 'B'));
  // pass 0: right notes for bar 1 (the third an octave up), silence in bar 2
  sc.tick(0, 0, 28);
  sc.tick(0.25, 0, 42); // beat 1: 30 + 12
  sc.tick(0.5, 0, 31);
  sc.tick(1.0, 0, undefined);
  sc.tick(1.5, 0, undefined);
  sc.tick(1.99, 0, undefined);
  // pass 1 starts: anything left of pass 0 is missed
  sc.tick(0, 1, 28);
  const s = sc.summary();
  assert.equal(s.hits, 4);
  assert.equal(s.total, 6); // pass 0: 5 notes (3 hit, bar 2's two missed), pass 1: the first note so far
  assert.deepEqual(s.missedBars, [1]);
  assert.deepEqual(s.sections, [{ name: 'A', hits: 4, total: 4 }, { name: 'B', hits: 0, total: 2 }]);
  assert.equal(sc.latest(0), 'hit');
  assert.equal(sc.latest(4), 'miss');
  // the wrong note is a miss once its window is over
  const sc2 = new Scorer(loopNotes(TAB, { from: 0, bars: 1, bpb: 4 }), { from: 0, bars: 1, bpb: 4 }, 2, () => '');
  sc2.tick(0, 0, 29);
  sc2.tick(0.2, 0, 29);
  assert.equal(sc2.latest(0), 'miss');
});

test('practice step: waits for each note, needs a new attack for a repeat', () => {
  const tab = [note(0, 28), note(1, 28), note(2, 33, 1, 0)];
  const st = new Stepper(loopNotes(tab, { from: 0, bars: 1, bpb: 4 }), 3);
  assert.equal(st.steps.length, 3);
  assert.equal(st.feed(28), false);
  assert.equal(st.feed(28), false);
  assert.equal(st.feed(28), true); // held 3 readings
  assert.equal(st.index, 1);
  // the same E still ringing doesn't pass the repeated E
  for (let k = 0; k < 5; k++) assert.equal(st.feed(28), false);
  st.feed(undefined); // a gap: new attack
  st.feed(28); st.feed(28);
  assert.equal(st.feed(28), true);
  st.feed(45); st.feed(45); // A an octave up
  assert.equal(st.feed(45), true);
  assert.ok(st.done);
  st.restart();
  assert.equal(st.index, 0);
});
