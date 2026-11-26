// The Workshop's Hydra editor (studies/reymenta-workshop.md step 5): the user's shortcuts (from his 2021 editor),
// the completion list read from hydra-synth, the parameter hint, running code against a synth, and Hydra sketches in
// the library (validation, round trip, merge).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import glslFunctions from 'hydra-synth/src/glsl/glsl-functions.js';
import { callAt, hintAt, hydraFunctions, hydraOptions, signature, snippetFor } from '../web/src/workshop/hydraComplete';
import { blockAt, compile, errorLine, run } from '../web/src/workshop/hydraEval';
import { expand, SHORTCUTS } from '../web/src/workshop/hydraShortcuts';
import { MAX_HYDRA_BYTES, starterSketch, validateHydra } from '../web/src/workshop/hydra';
import {
  addSketch, addTrack, conflicts, deleteTrack, detectImport, emptyLibrary, exportHydra, exportLibrary, merge, setHydra, updateSketch, validateLibrary,
} from '../web/src/workshop/library';

/** applies an expansion to a line, returns the new line and the selected text */
function apply(line: string, opts?: { strict?: boolean }) {
  const x = expand(line, opts);
  if (!x) return undefined;
  const start = line.length - x.length;
  const out = line.slice(0, start) + x.insert;
  return { out, sel: out.slice(start + x.from, start + x.to), x };
}

test('shortcuts: the 32 of the 2021 editor, expanded with the same selection', () => {
  assert.equal(SHORTCUTS.length, 32);
  assert.equal(new Set(SHORTCUTS.map((s) => s.key)).size, 32);
  const mx = apply('  mx')!;
  assert.equal(mx.out, '  modulateRepeatX(osc(10), reps = 5.0, offset = () => Math.sin(time) * 5)');
  assert.equal(mx.sel, 'osc'); // pos1 + 16 .. pos2 + 17
  assert.equal(apply('osc().mr')!.sel, 'noise');
  assert.equal(apply('mp')!.sel, 'osc(');
  const mk = apply('osc().mk')!;
  assert.equal(mk.sel, 'o0'); // pos1 + 15 .. pos2 + 15
  assert.equal(apply('sx')!.sel, 'o0');
  assert.equal(apply('sa')!.sel, '0.1');
  assert.equal(apply('x = s')!.sel, '.sin') // as the original computed it;
  assert.equal(apply('2')!.sel, 'vv');
  assert.equal(apply('3')!.sel, 'vvv');
  assert.equal(apply('f')!.sel, 'fcf');
  const paren = apply('(')!;
  assert.equal(paren.out, '()');
  assert.equal(paren.x.from, 2); // the cursor after the text, no selection
  assert.equal(apply('#')!.sel, 'V');
  // two characters before one: "ms" is modulateScale, not "m" then "s"
  assert.ok(apply('ms')!.out.startsWith('modulateScale('));
});

test('shortcuts: a key inside a word opens the list instead (strict), the original expanded anyway', () => {
  assert.equal(expand('pos'), undefined);
  assert.equal(expand('modulat'), undefined);
  assert.equal(expand('osc'), undefined);
  assert.equal(apply('pos', { strict: false })!.out, 'poMath.sin(time)');
  assert.ok(expand('osc().mx')); // after a dot
  assert.ok(expand('foo(')); // punctuation keys always
  assert.equal(expand(''), undefined);
});

test("completion: every function of hydra-synth's own list, with its defaults", () => {
  const defs = glslFunctions();
  const fns = hydraFunctions();
  for (const d of defs) {
    const f = fns.find((x) => x.name === d.name);
    assert.ok(f, d.name);
    assert.equal(f.kind, d.type);
  }
  const osc = fns.find((f) => f.name === 'osc')!;
  assert.equal(signature(osc), 'osc(frequency = 60, sync = 0.1, offset = 0)');
  assert.equal(snippetFor(osc), 'osc(frequency = ${1:60}, sync = ${2:0.1}, offset = ${3:0})');
  // combine functions take a texture first; Hydra globals and function names are written as values only
  const mod = fns.find((f) => f.name === 'modulateScrollX')!;
  assert.equal(snippetFor(mod), 'modulateScrollX(${1:o0}, scrollX = ${2:0.5}, ${3:0})');
  assert.equal(snippetFor(fns.find((f) => f.name === 'noise')!), 'noise(scale = ${1:10}, offset = ${2:0.1})');
  assert.equal(snippetFor(fns.find((f) => f.name === 'diff')!), 'diff(${1:o0})');
  assert.ok(fns.some((f) => f.name === 'out'));
  const afterDot = hydraOptions(true);
  assert.equal(afterDot.find((o) => o.label === 'rotate')!.boost, 1);
  assert.equal(afterDot.find((o) => o.label === 'osc')!.boost, -1);
});

test('parameter hint: the call and the argument under the cursor', () => {
  assert.deepEqual(callAt('osc(10, '), { name: 'osc', arg: 1, method: false });
  assert.deepEqual(callAt('osc().rotate('), { name: 'rotate', arg: 0, method: true });
  assert.deepEqual(callAt('osc([1, 2, 3].fast(2), 0.1, '), { name: 'osc', arg: 2, method: false });
  assert.deepEqual(callAt('osc(() => Math.sin(time) * 2, '), { name: 'osc', arg: 1, method: false });
  assert.deepEqual(callAt('osc([1, 2'), { name: 'osc', arg: 0, method: false });
  assert.equal(callAt('osc(1).out()'), undefined);
  const h = hintAt('noise(3).modulate(o1, ')!;
  assert.equal(h.fn.name, 'modulate');
  assert.equal(h.fn.params[h.arg].name, 'amount');
  assert.equal(hintAt('Math.sin('), undefined);
});

test('running code: against the synth, bpm assigned there, the line of an error', async () => {
  const outs: string[] = [];
  const synth = { bpm: 30, osc: (f: number) => ({ out: () => outs.push(`osc ${f}`) }) };
  await run('bpm = 128\nosc(4).out()', synth);
  assert.equal(synth.bpm, 128);
  assert.deepEqual(outs, ['osc 4']);
  await assert.rejects(run('osc(1).out()\n\nnope()\n', synth), /nope/);
  try { await run('osc(1).out()\n\nnope()\n', synth); } catch (e) { assert.equal(await errorLine(e, 3), 3); }
  assert.throws(() => compile('osc(\n.out('), SyntaxError);
  assert.deepEqual(blockAt(['a', 'b', '', 'c', 'd', 'e', '', 'f'], 4), { from: 3, to: 5 });
  assert.deepEqual(blockAt(['a'], 0), { from: 0, to: 0 });
});

test('sketches: validated, starter uses the bpm', () => {
  assert.equal(typeof validateHydra('osc().out()'), 'string');
  assert.equal(validateHydra('a\r\nb'), 'a\nb');
  assert.equal(typeof validateHydra('x'.repeat(MAX_HYDRA_BYTES + 1)), 'object');
  assert.equal(typeof validateHydra('<!doctype html><p>404'), 'object');
  assert.equal(typeof validateHydra(42), 'object');
  assert.match(starterSketch({ title: 'Song', bpm: 136 }), /^bpm = 136$/m);
  assert.doesNotMatch(starterSketch({ title: 'Free' }), /^bpm =/m);
});

test('library: Hydra per track and free sketches round trip, merge, delete', () => {
  let { library: lib } = addTrack(emptyLibrary(), 'Song', { bpm: 120 });
  lib = setHydra(lib, 'song', starterSketch({ title: 'Song', bpm: 120 }));
  let id: string;
  ({ library: lib, sketch: { id } } = addSketch(lib, 'Dark one', 'osc().out()'));
  ({ library: lib } = addSketch(lib, 'Dark one', 'noise().out()'));
  assert.deepEqual(lib.sketches.map((s) => s.id), ['darkone', 'darkone-2']);
  lib = updateSketch(lib, id, { code: 'voronoi().out()' });
  assert.equal(lib.sketches[0].code, 'voronoi().out()');
  assert.equal(exportHydra(lib, 'song'), lib.hydra.song);

  const back = detectImport(exportLibrary(lib));
  assert.equal(back.kind, 'library');
  if (back.kind === 'library') { assert.deepEqual(back.library, lib); assert.equal(back.skipped, 0); }

  // bad entries skipped, counted
  const bad = validateLibrary({ app: 'videodromm-library', version: 1, hydra: { song: 'x'.repeat(MAX_HYDRA_BYTES + 1), '../x': 'osc()' }, sketches: [{ id: 'BAD ID', code: '' }, { id: 'ok', code: 1 }] });
  assert.ok(typeof bad !== 'string');
  assert.equal(bad.skipped, 4);
  assert.deepEqual(bad.library.hydra, {});

  // a different sketch with the same id: a conflict, replaced or kept as a copy; a track's Hydra travels with it
  const theirs = { ...emptyLibrary(), sketches: [{ ...lib.sketches[0], code: 'shape(4).out()' }], tracks: lib.tracks, hydra: { song: 'osc(2).out()' } };
  assert.deepEqual(conflicts(lib, theirs), { tracks: ['song'], setlists: [], sketches: ['Dark one'] });
  const r = merge(lib, theirs, 'replace');
  assert.equal(r.library.sketches[0].code, 'shape(4).out()');
  assert.equal(r.library.hydra.song, 'osc(2).out()');
  const k = merge(lib, theirs, 'keep');
  assert.deepEqual(k.library.sketches.map((s) => s.id), ['darkone', 'darkone-2', 'darkone-3']);
  assert.equal(k.library.hydra['song-2'], 'osc(2).out()');

  lib = deleteTrack(lib, 'song');
  assert.equal(lib.hydra.song, undefined);
});
