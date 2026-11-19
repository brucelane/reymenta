// Step 4 of studies/reymenta-workshop.md: the drum tab (grid, code, quantizing haps), the template patch, adding the
// drums to a patch, the library's new fields (patches, drums, originals). Strudel itself is evaluated in Node (no
// audio) with @strudel/core + mini + transpiler 1.2.6, the versions @strudel/web 1.3.0 bundles (dev dependencies, only
// here), as repos/test/tools/check-strudel-patch.mjs does: the generated code really gives the grid back.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { patchCycles, patchSections } from '../src/core/strudelLength';
import {
  addDrumBar, barPattern, copyDrumBar, drumCode, drumExpression, drumTabFromHaps, drumVoiceOf, newDrumTab, removeDrumBar, rowArrange,
  stepsPerBar, toggleStep, validateDrumTab, type DrumTab,
} from '../web/src/workshop/drums';
import {
  addTrack, conflicts, deleteTrack, detectImport, emptyLibrary, exportLibrary, merge, setDrums, setOriginal, setPatch, validateLibrary,
} from '../web/src/workshop/library';
import { addDrumsToPatch, templatePatch, validatePatch } from '../web/src/workshop/patch';

// @strudel/core's repl imports @kabelsalat/web, whose Node entry has no ES exports: stubbed (not used here)
register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === "@kabelsalat/web") return { url: "data:text/javascript,export class SalatRepl {}", shortCircuit: true };
  return next(s, c);
}`));

type NodeHap = { whole?: { begin: { valueOf(): number } }; value: Record<string, unknown>; hasOnset(): boolean };
let strudel: Promise<(code: string) => Promise<{ queryArc(a: number, b: number): NodeHap[] }>> | undefined;
/** code -> its pattern, evaluated as the Strudel REPL does (transpiled: "..." are mini-notation) */
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
  return pat.queryArc(0, cycles).filter((h) => h.whole && h.hasOnset()).map((h) => ({ begin: h.whole!.begin.valueOf(), value: h.value }));
}

const FIX = join(import.meta.dirname, 'fixtures', 'library');
const PUBLIC = join(import.meta.dirname, '..', '..', 'assets', 'public', 'library', 'patches');

function sample(): DrumTab {
  let d = newDrumTab({ bars: 1, basic: true });
  d = copyDrumBar(d, 0);
  d = toggleStep(d, 1, 'oh', 14);
  d = toggleStep(d, 1, 'sd', 15);
  d = toggleStep(d, 1, 'bd', 0); // off
  d = addDrumBar(d, 1); // an empty third bar
  d = toggleStep(d, 2, 'cr', 0);
  return d;
}

test('drum grid: toggles, bars, patterns made short', () => {
  assert.equal(stepsPerBar(4), 16);
  assert.equal(stepsPerBar(3.5), 14);
  const d = sample();
  assert.equal(d.bars.length, 3);
  assert.deepEqual(d.rows, ['bd', 'sd', 'hh', 'oh', 'cr']);
  assert.equal(d.bars[1].hits.bd, '........x.......');
  assert.equal(barPattern(d.bars[0], 'bd'), 'bd bd');
  assert.equal(barPattern(d.bars[0], 'hh'), 'hh hh hh hh hh hh hh hh');
  assert.equal(barPattern(d.bars[1], 'sd'), '~ ~ ~ ~ sd ~ ~ ~ ~ ~ ~ ~ sd ~ ~ sd');
  assert.equal(barPattern(d.bars[2], 'sd'), '~');
  assert.deepEqual(rowArrange(d, 'hh'), [[2, 'hh hh hh hh hh hh hh hh'], [1, '~']]);
  assert.equal(removeDrumBar(d, 2).bars.length, 2);
  assert.equal(removeDrumBar(newDrumTab(), 0).bars.length, 1); // never empty
  assert.equal(drumExpression(newDrumTab()), 'silence');
  assert.match(drumCode(d, { bpm: 136 }), /setcpm\(136\/4\)\nstack\(/);
});

test('drum grid <-> code: the generated code, evaluated by Strudel, gives the same grid back', async () => {
  for (const d of [sample(), newDrumTab({ beatsPerBar: 3.5, bars: 2, basic: true })]) {
    const code = drumCode(d, { beatsPerBar: d.bars[0].steps / 4 });
    const back = drumTabFromHaps(await haps(code, d.bars.length), { bars: d.bars.length, beatsPerBar: d.bars[0].steps / 4 });
    assert.ok(back);
    assert.equal(back.kit, d.kit);
    assert.deepEqual(back.bars, d.bars);
  }
});

test('haps quantized into the grid: nearest 16th, bar end to the next bar, banked names, melodic notes ignored', () => {
  assert.equal(drumVoiceOf({ s: 'RolandTR909_bd', bank: 'RolandTR909' }), 'bd');
  assert.equal(drumVoiceOf({ s: 'ch' }), 'hh');
  assert.equal(drumVoiceOf({ s: 'bd', note: 40 }), undefined);
  assert.equal(drumVoiceOf({ s: 'gm_electric_bass_pick' }), undefined);
  const d = drumTabFromHaps([
    { begin: 0.26, value: { s: 'sd', bank: 'RolandTR808' } }, // ~ step 4
    { begin: 0.99, value: { s: 'bd', bank: 'RolandTR808' } }, // rounds to the next bar's 1
    { begin: 1.5, value: { s: 'oh' } },
    { begin: 0.5, value: { note: 'e2', s: 'gm_electric_bass_pick' } },
  ], { bars: 3 });
  assert.ok(d);
  assert.equal(d.kit, 'RolandTR808');
  assert.equal(d.bars.length, 3);
  assert.equal(d.bars[0].hits.sd, '....x...........');
  assert.equal(d.bars[1].hits.bd, 'x...............');
  assert.equal(d.bars[1].hits.oh, '........x.......');
  assert.deepEqual(d.rows, ['bd', 'sd', 'oh']);
  assert.equal(drumTabFromHaps([{ begin: 0, value: { note: 40 } }]), undefined);
});

test('drums read from a patch (the fixture, and the public Ambivalence/Namaste when present)', async () => {
  const code = readFileSync(join(FIX, 'patches', 'demo.strudel.js'), 'utf8');
  const bars = patchCycles(code)!;
  assert.equal(bars, 4);
  const d = drumTabFromHaps(await haps(code, bars), { bars })!;
  assert.equal(d.kit, 'RolandTR909');
  assert.deepEqual(d.rows, ['bd', 'sd', 'hh']);
  assert.equal(d.bars[0].hits.bd, 'x...x...x...x...');
  assert.equal(d.bars[3].hits.bd, 'x.....x.....x...');
  assert.equal(d.bars[0].hits.hh, undefined);
  assert.equal(d.bars[3].hits.hh, 'x.x.x.x.x.x.x.x.');
  for (const name of ['ambivalence', 'namaste']) {
    const f = join(PUBLIC, `${name}.strudel.js`);
    if (!existsSync(f)) continue; // the public library is built by live/build-public-library.mjs (git-ignored)
    const p = readFileSync(f, 'utf8');
    const n = patchCycles(p)!;
    const tab = drumTabFromHaps(await haps(p, Math.ceil(n)), { bars: n })!;
    assert.ok(tab, name);
    assert.equal(tab.bars.length, Math.ceil(n), name);
    assert.ok(tab.rows.includes('bd') && tab.rows.includes('sd'), name);
    assert.equal(typeof validateDrumTab(tab), 'object', name);
  }
});

test('template patch: tempo, sections, plays (drums + bass), key respected', async () => {
  const code = templatePatch({ title: 'New one', bpm: 136, beatsPerBar: 4, tonality: 'A', mode: 'minor' });
  assert.match(code, /setcpm\(136\/4\)/);
  assert.equal(patchCycles(code), 8);
  assert.deepEqual(patchSections(code), [{ name: 'A', bar: 1 }, { name: 'B', bar: 5 }]);
  assert.match(code, /"a2 ~ a2 e2"/); // root, fifth
  assert.match(code, /"d2 ~ d2 a2"/); // fourth, root
  const h = await haps(code, 8);
  assert.ok(h.some((x) => x.value.s === 'bd' && x.value.bank === 'RolandTR909'));
  assert.ok(h.some((x) => x.value.note === 'a2'));
  const d = drumTabFromHaps(h, { bars: 8 })!;
  assert.equal(d.bars.length, 8);
  // odd meters and modes without a fifth still give a patch
  const odd = templatePatch({ title: 'x', bpm: 100, beatsPerBar: 3.5, tonality: 'F#', mode: 'blues' });
  assert.match(odd, /setcpm\(100\/3\.5\)/);
  assert.ok((await haps(odd, 8)).length > 0);
});

test('drums added to a patch: before its final stack(), or as a $: block', async () => {
  const d = sample();
  const patch = readFileSync(join(FIX, 'patches', 'demo.strudel.js'), 'utf8');
  const next = addDrumsToPatch(patch, drumExpression(d))!;
  assert.match(next, /const drums = stack\(/);
  assert.match(next, /^stack\(drums, bass, bd, sd, hh\)$/m);
  assert.ok((await haps(next, 4)).some((x) => x.value.s === 'cr')); // the tab's crash plays
  const twice = addDrumsToPatch(next, drumExpression(d))!;
  assert.match(twice, /^stack\(drums2, drums, bass/m);
  const multi = addDrumsToPatch('stack(\n  a,\n  b\n)', 'silence')!;
  assert.match(multi, /const drums = silence\n\nstack\(drums, \n  a,/);
  assert.match(addDrumsToPatch('$: s("bd")', 'silence')!, /\$: silence\n$/);
  assert.equal(addDrumsToPatch('s("bd")', 'silence'), undefined);
});

test('library: patches, drums and originals stored, validated, merged, exported, deleted', () => {
  let { library: lib, track } = addTrack(emptyLibrary(), 'Song', { bpm: 120 });
  const f = track.folder;
  lib = setOriginal(setPatch(lib, f, 'setcpm(30)\ns("bd")'), f, 'setcpm(30)\ns("bd")');
  lib = setDrums(lib, f, sample());
  const text = exportLibrary(lib);
  const parsed = JSON.parse(text);
  assert.equal(parsed.patches[f], 'setcpm(30)\ns("bd")');
  assert.equal(parsed.originals, undefined); // kept on the phone only
  const d = detectImport(text);
  assert.equal(d.kind, 'library');
  if (d.kind !== 'library') return;
  assert.deepEqual(d.library.drums[f], lib.drums[f]);
  assert.equal(d.skipped, 0);
  // stored form (with originals) reads back
  const stored = validateLibrary({ ...parsed, originals: { [f]: 'x' } });
  assert.ok(typeof stored !== 'string' && stored.library.originals[f] === 'x');
  // bad entries skipped, older files (no patches/drums) still fine
  const bad = validateLibrary({ ...parsed, patches: { [f]: 42, '../x': 'y', ok: '<!doctype html><p>404' }, drums: { [f]: { kit: 'X', bars: [{ steps: 16, hits: { zz: 'x' } }] } } });
  assert.ok(typeof bad !== 'string');
  if (typeof bad === 'string') return;
  assert.equal(bad.skipped, 4);
  assert.deepEqual(bad.library.patches, {});
  const old = validateLibrary({ app: 'videodromm-library', version: 1, tracks: [], setlists: [] });
  assert.ok(typeof old !== 'string' && Object.keys(old.library.patches).length === 0);
  assert.equal(validateDrumTab({ kit: 'RolandTR909', bars: [{ steps: 16, hits: { bd: 'x..' } }] }), 'bad hits for bd');
  assert.equal(typeof validatePatch('x'.repeat(300 * 1024)), 'object');
  assert.equal(validatePatch('a\r\nb'), 'a\nb');
  // merge: a different patch is a conflict; "keep" renames with its parts
  const theirs = { ...d.library, patches: { [f]: 's("sd")' } };
  assert.deepEqual(conflicts(lib, theirs).tracks, [f]);
  const kept = merge(lib, theirs, 'keep').library;
  assert.equal(kept.patches[`${f}-2`], 's("sd")');
  assert.deepEqual(kept.drums[`${f}-2`], lib.drums[f]);
  assert.equal(kept.patches[f], 'setcpm(30)\ns("bd")');
  assert.equal(merge(lib, theirs, 'replace').library.patches[f], 's("sd")');
  assert.equal(conflicts(lib, d.library).tracks.length, 0); // identical: no conflict
  const gone = deleteTrack(lib, f);
  assert.equal(gone.patches[f] ?? gone.drums[f] ?? gone.originals[f], undefined);
});
