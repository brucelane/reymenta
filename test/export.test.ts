// Step 6 of studies/reymenta-workshop.md: a track exported as MIDI (bytes checked), as an Ableton set written from the
// template like TSWebsocketServer's alsExport.ts (gunzipped, parsed as XML, one MIDI track per part with its notes,
// unique pointee ids), the whole track as one JSON read back, and strudel-flow's code turned into a patch part.
// The patch's haps come from Strudel evaluated in Node (as strudel.test.ts does); gzip from node:zlib.
import { DOMParser } from '@xmldom/xmldom';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';
import { test } from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';
import { POINTEE, writeAlsXml } from '../web/src/workshop/alsWrite';
import { newDrumTab } from '../web/src/workshop/drums';
import { flowPatchInfo, grooveAsPatch, grooveExpression, parseGroove, validFlowUrl } from '../web/src/workshop/grooves';
import { addTrack, detectImport, emptyLibrary, exportWholeTrack, merge, setDrums, setHydra, setPatch, setTab } from '../web/src/workshop/library';
import { addToPatch } from '../web/src/workshop/patch';
import {
  buildExportSong, hapKey, noteNameToMidi, partChannels, partsFromHaps, songToMidiFile, timeSignature, type ExportSong,
} from '../web/src/workshop/songExport';
import { newTab, setNote, setSection } from '../web/src/workshop/tabEdit';

register('data:text/javascript,' + encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === "@kabelsalat/web") return { url: "data:text/javascript,export class SalatRepl {}", shortCircuit: true };
  return next(s, c);
}`));
type NodeHap = { whole?: { begin: { valueOf(): number }; end: { valueOf(): number } }; value: Record<string, unknown>; hasOnset(): boolean };
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
  return pat.queryArc(0, cycles).filter((h) => h.whole && h.hasOnset())
    .map((h) => ({ begin: h.whole!.begin.valueOf(), end: h.whole!.end.valueOf(), value: h.value }));
}

const TEMPLATE = join(import.meta.dirname, '..', 'web', 'src', 'workshop', 'als', 'empty.als');
const PATCH = `// Sections (bars): A 1-2 | B 3-4
setcpm(100/4)
stack(
  s("bd ~ sd ~").bank("RolandTR909"),
  note("e2 g2").s("gm_electric_bass_pick"),
  note("e4").s("sawtooth")
)`;

/** A small track: a 2-note bass tab with a section, a one-bar drum groove, the patch above. */
async function song(): Promise<ExportSong> {
  let tab = newTab({ source: 'x.workshop', tempo: 100, beatsPerBar: 4 });
  tab = setNote(tab, { beat: 0, string: 0, fret: 0, dur: 1 });
  tab = setNote(tab, { beat: 2, string: 1, fret: 2, dur: 0.5 });
  tab = setSection(tab, 0, 'A');
  return buildExportSong({
    title: 'Test', bpm: 100, beatsPerBar: 4, tab, drums: newDrumTab({ basic: true }), patch: PATCH, haps: await haps(PATCH, 4),
  });
}

/** MIDI chunks: [type, body] */
function chunks(b: Uint8Array): [string, Uint8Array][] {
  const out: [string, Uint8Array][] = [];
  for (let o = 0; o < b.length;) {
    const type = String.fromCharCode(...b.slice(o, o + 4));
    const len = (b[o + 4] << 24) | (b[o + 5] << 16) | (b[o + 6] << 8) | b[o + 7];
    out.push([type, b.slice(o + 8, o + 8 + len)]);
    o += 8 + len;
  }
  return out;
}
/** A track's channel events: [tick, status, key, vel] (no running status: the writer never uses it) */
function events(body: Uint8Array): [number, number, number, number][] {
  const out: [number, number, number, number][] = [];
  let o = 0, tick = 0;
  const vlq = () => { let v = 0; for (;;) { const c = body[o++]; v = (v << 7) | (c & 0x7f); if (!(c & 0x80)) return v; } };
  while (o < body.length) {
    tick += vlq();
    const st = body[o++];
    if (st === 0xff) { o++; const len = vlq(); o += len; continue; }
    out.push([tick, st, body[o], body[o + 1]]);
    o += 2;
  }
  return out;
}

test('parts: tab, drum tab, one per patch sound; keys, channels, sections', async () => {
  const s = await song();
  assert.deepEqual(s.parts.map((p) => p.name), ['tabbass', 'tabdrums', 'RolandTR909 bd notes', 'RolandTR909 sd notes', 'gm_electric_bass_pick notes', 'sawtooth notes']);
  assert.deepEqual(s.parts.map((p) => p.drum), [false, true, true, true, false, false]);
  assert.deepEqual(partChannels(s.parts), [0, 9, 9, 9, 1, 2]);
  assert.deepEqual(s.parts[0].notes.map((n) => n.key), [28, 35]); // open E, B on the A string
  assert.deepEqual(s.parts[2].notes.map((n) => [n.beat, n.key]), [[0, 36], [4, 36], [8, 36], [12, 36]]);
  assert.deepEqual(s.parts[4].notes.slice(0, 2).map((n) => [n.beat, n.dur, n.key]), [[0, 2, 40], [2, 2, 43]]);
  assert.equal(s.beats, 16);
  assert.deepEqual(s.locators, [{ beat: 0, name: '#A' }]); // the tab's sections win over the patch's header
  const noTab = buildExportSong({ title: 'x', beatsPerBar: 4, patch: PATCH, haps: await haps(PATCH, 4) });
  assert.deepEqual(noTab.locators, [{ beat: 0, name: '#A' }, { beat: 8, name: '#B' }]);
  assert.equal(noteNameToMidi('c4'), 60);
  assert.equal(noteNameToMidi('eb2'), 39);
  assert.equal(noteNameToMidi('a'), 57);
  assert.equal(hapKey({ freq: 440 }), 69);
  assert.equal(hapKey({ s: 'RolandTR808_hh', bank: 'RolandTR808' }), 42);
  assert.deepEqual(timeSignature(3.5), [7, 8]);
  assert.deepEqual(partsFromHaps([], 4), []);
});

test('MIDI file: header, one track per part, note on/off, tempo and markers', async () => {
  const s = await song();
  const b = songToMidiFile(s);
  const cs = chunks(b);
  assert.equal(cs[0][0], 'MThd');
  assert.deepEqual([...cs[0][1]], [0, 1, 0, s.parts.length + 1, 0x01, 0xe0]); // type 1, tracks, 480 ppq
  assert.equal(cs.length, s.parts.length + 2);
  assert.ok(cs.slice(1).every(([t]) => t === 'MTrk'));
  // conductor: tempo 100 bpm = 600000 us, 4/4, the marker "#A"
  const conductor = [...cs[1][1]];
  const at = conductor.findIndex((x, i) => x === 0xff && conductor[i + 1] === 0x51);
  assert.deepEqual(conductor.slice(at + 3, at + 6), [0x09, 0x27, 0xc0]);
  assert.ok(Buffer.from(cs[1][1]).includes(Buffer.from('#A')));
  // bass tab: E1 on at 0, off at 480 ticks, channel 1; B1 at beat 2
  assert.deepEqual(events(cs[2][1]), [[0, 0x90, 28, 100], [480, 0x80, 28, 0], [960, 0x90, 35, 100], [1200, 0x80, 35, 0]]);
  // drum tab on channel 10
  assert.ok(events(cs[3][1]).every(([, st]) => (st & 0x0f) === 9));
  assert.deepEqual([...b.slice(-3)], [0xff, 0x2f, 0]); // ends with an end-of-track
});

test('.als: gunzips, parses as XML, a MIDI track per part with its notes, tempo, locators, unique ids', async () => {
  const s = await song();
  const template = gunzipSync(readFileSync(TEMPLATE)).toString('utf8');
  const gz = gzipSync(Buffer.from(writeAlsXml(template, s), 'utf8'));
  const xml = gunzipSync(gz).toString('utf8');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const tracks = Array.from(doc.getElementsByTagName('MidiTrack'));
  assert.equal(tracks.length, s.parts.length);
  assert.equal(doc.getElementsByTagName('AudioTrack').length, 0);
  assert.equal(doc.getElementsByTagName('ReturnTrack').length, 2);
  const names = tracks.map((t) => t.getElementsByTagName('EffectiveName')[0].getAttribute('Value'));
  assert.deepEqual(names, s.parts.map((p) => p.name));
  tracks.forEach((t, i) => assert.equal(t.getElementsByTagName('MidiNoteEvent').length, s.parts[i].notes.length, names[i]!));
  const bass = tracks[0].getElementsByTagName('KeyTrack');
  assert.deepEqual(Array.from(bass).map((k) => k.getElementsByTagName('MidiKey')[0].getAttribute('Value')), ['28', '35']);
  const tempo = doc.getElementsByTagName('Tempo')[0].getElementsByTagName('Manual')[0].getAttribute('Value');
  assert.equal(tempo, '100');
  const locs = Array.from(doc.getElementsByTagName('Locator')).map((l) => l.getElementsByTagName('Name')[0].getAttribute('Value'));
  assert.deepEqual(locs, ['#A']);
  // ids: pointees unique and below NextPointeeId, track ids unique
  const ids = [...xml.matchAll(POINTEE)].map((m) => Number(m[3]));
  assert.equal(new Set(ids).size, ids.length);
  const next = Number(/<NextPointeeId Value="(\d+)"/.exec(xml)![1]);
  assert.ok(Math.max(...ids) < next);
  const trackIds = [...xml.matchAll(/<(?:MidiTrack|ReturnTrack) Id="(\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(trackIds).size, trackIds.length);
  assert.throws(() => writeAlsXml(template, { ...s, parts: [] }), /nothing to export/);
});

test('the whole track as one JSON reads back (round trip)', () => {
  let { library: lib, track } = addTrack(emptyLibrary(), 'Round Trip', { bpm: 97 });
  const f = track.folder;
  lib = setTab(lib, f, setNote(lib.tabs[f], { beat: 1, string: 2, fret: 3, dur: 1 }));
  lib = setPatch(lib, f, PATCH);
  lib = setDrums(lib, f, newDrumTab({ basic: true }));
  lib = setHydra(lib, f, 'osc(10).out()');
  const { library: other } = addTrack(lib, 'Other');
  const text = exportWholeTrack(other, f)!;
  const d = detectImport(text);
  assert.equal(d.kind, 'library');
  if (d.kind !== 'library') return;
  assert.equal(d.skipped, 0);
  assert.deepEqual(d.library.tracks.map((x) => x.folder), [f]);
  const back = merge(emptyLibrary(), d.library, 'keep').library;
  assert.deepEqual(back.tracks, [lib.tracks[0]].map((x) => ({ ...x, tabFile: `${f}.tab.json`, tab: { tuning: 'EADG' } })));
  assert.deepEqual(back.tabs[f], lib.tabs[f]);
  assert.equal(back.patches[f], PATCH);
  assert.deepEqual(back.drums[f], lib.drums[f]);
  assert.equal(back.hydra[f], 'osc(10).out()');
  assert.equal(exportWholeTrack(lib, 'nope'), undefined);
});

test('strudel-flow: its code parsed, added to a patch, its JSON recognised', async () => {
  // as strudel-flow's generateOutput writes it: setcpm, one $: per chain, paused chains commented
  const flow = 'setcpm(120/4)\n$: sound("bd*4").bank("RolandTR808")\n  .gain(0.9)\n// $: sound("hh*8")\n$: note("c2 eb2").s("sawtooth")';
  const g = parseGroove(flow);
  assert.ok(!('error' in g));
  if ('error' in g) return;
  assert.equal(g.cpm, '120/4');
  assert.deepEqual(g.parts, ['sound("bd*4").bank("RolandTR808")\n  .gain(0.9)', 'note("c2 eb2").s("sawtooth")']);
  const expr = grooveExpression(g);
  assert.ok(expr.startsWith('stack('));
  // it evaluates, alone and inside a patch
  assert.equal((await haps(grooveAsPatch(g, 'G'), 1)).length, 6);
  const patched = addToPatch(PATCH, expr, 'groove')!;
  assert.match(patched, /const groove = stack\(/);
  assert.match(patched, /^stack\(groove, $/m);
  assert.equal((await haps(patched, 1)).length, (await haps(PATCH, 1)).length + 6);
  assert.deepEqual(parseGroove('// nothing\n'), { error: 'no pattern' });
  assert.deepEqual(parseGroove('{"nodes": []}'), { error: 'JSON, not code' });
  assert.deepEqual(parseGroove('s("bd sd")'), { parts: ['s("bd sd")'], cpm: undefined });
  const json = JSON.stringify({ name: 'Tunnel 1', nodes: [{ id: 'a' }, { id: 'b' }], edges: [], theme: 'x', colorMode: 'dark', cpm: '128', bpc: '4' });
  assert.deepEqual(flowPatchInfo(json), { name: 'Tunnel 1', cpm: '128', bpc: '4', nodes: 2 });
  assert.equal(flowPatchInfo('{"a":1}'), undefined);
  assert.equal(validFlowUrl('javascript:alert(1)'), undefined);
  assert.equal(validFlowUrl('https://app.videodromm.com'), 'https://app.videodromm.com/');
});
