// The Workshop's pure logic (studies/reymenta-workshop.md step 3): library validation/merge, import detection, the tab
// editor's note operations, the public index, the fretboard, and the /api/library route.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { test } from 'node:test';
import { computeBars, fretBass } from '../src/core/songGrid';
import { handleLibrary, libraryFile } from '../src/server/library';
import { librarySources, toIndexTrack, toLibraryTrack, validateIndex } from '../web/src/workshop/catalogue';
import { fretRows, INSTRUMENTS, stringNames } from '../web/src/workshop/fretboardNotes';
import {
  addSetlist, addToSetlist, addTrack, conflicts, deleteTrack, detectImport, emptyLibrary, exportLibrary, exportSetlist,
  exportTab, exportTrack, merge, moveInSetlist, removeFromSetlist, renameSetlist, setTab, slug, validateTrack,
} from '../web/src/workshop/library';
import {
  addBar, deleteNote, editorBars, newTab, noteAt, noteWarnings, removeBar, setBeatsPerBar, setDuration, setNote, setSection,
  setTuning, toTabMsg, validateTab, type WTab,
} from '../web/src/workshop/tabEdit';

const FIX = join(import.meta.dirname, 'fixtures', 'library');
const REPO_TAB = join(import.meta.dirname, '..', '..', 'assets', 'glsl', 'hexbolt', 'hexbolt.tab.json');

/** what the WebApp's Track pane needs: TabData fields, notes in tabbass, tab = fretBass of them */
function assertValidTab(t: WTab) {
  assert.equal(t.version, 1);
  assert.ok(['EADG', 'DADG'].includes(t.tuning));
  const notes = t.song.tracks.tabbass;
  assert.ok(Array.isArray(notes));
  for (let i = 1; i < notes.length; i++) assert.ok(notes[i].beat >= notes[i - 1].beat, 'notes sorted');
  for (const k of Object.keys(t.overrides)) assert.ok(Number(k) < notes.length, 'override on a note');
  const expect = fretBass(notes, t.tuning, t.overrides).map(({ beat, dur, key, string, fret, finger }) => ({ beat, dur, key, string, fret, finger }));
  assert.deepEqual(t.tab, expect);
  assert.ok(computeBars(t.song).length >= 0);
}

test('tab editor: notes put, replaced, lengthened, deleted; strings kept as overrides', () => {
  let t = newTab({ source: 'x.workshop', tempo: 100 });
  assert.equal(editorBars(t).length, 4);
  t = setNote(t, { beat: 1, string: 1, fret: 3, dur: 0.5 }); // C2 on the A string
  t = setNote(t, { beat: 0, string: 0, fret: 0, dur: 1 }); // open E, before it
  assertValidTab(t);
  assert.deepEqual(t.song.tracks.tabbass.map((n) => n.key), [28, 36]);
  assert.deepEqual(t.overrides, { 0: { string: 0 }, 1: { string: 1 } });
  // the same key on another string: the override keeps the string chosen
  t = setNote(t, { beat: 2, string: 0, fret: 8, dur: 0.25 });
  assert.equal(t.tab[2].string, 0);
  assert.equal(t.tab[2].fret, 8);
  // replace the note at the same place and string
  t = setNote(t, { beat: 1, string: 1, fret: 5, dur: 0.5 });
  assert.equal(t.song.tracks.tabbass.length, 3);
  assert.equal(t.tab[noteAt(t, 1, 1)].fret, 5);
  t = setDuration(t, noteAt(t, 1, 1), 2);
  assert.equal(t.song.tracks.tabbass[1].dur, 2);
  t = deleteNote(t, 0);
  assertValidTab(t);
  assert.deepEqual(t.overrides, { 0: { string: 1 }, 1: { string: 0 } });
  assert.equal(noteAt(t, 0, 0), -1);
});

test('tab editor: bars added and removed move the notes and sections', () => {
  let t = newTab({ source: 'x', tempo: 120, bars: 2 });
  t = setNote(t, { beat: 0, string: 1, fret: 2, dur: 1 });
  t = setNote(t, { beat: 4, string: 2, fret: 2, dur: 1 });
  t = setSection(t, 1, 'chorus');
  assert.deepEqual(t.song.locators, [{ beat: 4, name: '#chorus' }]);
  assert.deepEqual(editorBars(t)[1].sections, ['chorus']);
  t = addBar(t, 0); // an empty bar after bar 1
  assert.equal(editorBars(t).length, 3);
  assert.deepEqual(t.song.tracks.tabbass.map((n) => n.beat), [0, 8]);
  assert.deepEqual(t.song.locators, [{ beat: 8, name: '#chorus' }]);
  t = removeBar(t, 0); // the first bar and its note go
  assert.deepEqual(t.song.tracks.tabbass.map((n) => n.beat), [4]);
  assert.deepEqual(t.song.locators, [{ beat: 4, name: '#chorus' }]);
  assert.equal(editorBars(t).length, 2);
  t = setSection(t, 1, '');
  assert.deepEqual(t.song.locators, []);
  assertValidTab(t);
});

test('tab editor: meter and tuning; the bass rules warn', () => {
  let t = newTab({ source: 'x', tempo: 120, beatsPerBar: 4 });
  t = setNote(t, { beat: 0, string: 0, fret: 3, dur: 1 });
  t = setBeatsPerBar(t, 3.5);
  assert.deepEqual(t.song.barBeats, [3.5]);
  assert.equal(t.song.cycleBeats, 3.5);
  assert.equal(editorBars(t)[1].start, 3.5);
  t = setBeatsPerBar(t, 4);
  assert.equal(t.song.barBeats, undefined);
  t = setTuning(t, 'DADG');
  assert.equal(t.tab[0].fret, 5); // G1 on the low D
  assertValidTab(t);
  assert.deepEqual(noteWarnings({ key: 28, string: 0, fret: 0 }), []);
  assert.deepEqual(noteWarnings({ key: 33, string: 1, fret: 0 }), ['open']);
  assert.deepEqual(noteWarnings({ key: 55, string: 3, fret: 12 }), ['range']);
  const msg = toTabMsg(t, 'x', 'X');
  assert.deepEqual(msg.n, [[0, 0, 5, 1]]);
  assert.equal(msg.bb, 4);
});

test("a repo tab (Hex Bolt) validates, keeps its notes, and round-trips", () => {
  const raw = JSON.parse(readFileSync(REPO_TAB, 'utf8'));
  const t = validateTab(raw);
  assert.ok(typeof t !== 'string');
  assert.equal(t.song.tracks.tabbass.length, raw.song.tracks.tabbass.length);
  assert.deepEqual(t.tab, raw.tab);
  const again = validateTab(JSON.parse(JSON.stringify(t)));
  assert.deepEqual(again, t);
});

test('validation refuses bad tabs and cleans tracks', () => {
  assert.equal(typeof validateTab({ version: 2 }), 'string');
  assert.equal(typeof validateTab({ version: 1, tuning: 'XXXX', song: { tempo: 1 } }), 'string');
  assert.equal(typeof validateTab({ version: 1, tuning: 'EADG', song: { tempo: 120, tracks: { tabbass: [{ beat: 'a' }] } } }), 'string');
  const t = validateTrack({ id: 'x', folder: 'x', title: 'X\nY', bpm: 'fast', mode: 'constructor', tab: 'tabs/x.tab.json', strudel: 'x.strudel.js', evil: { a: 1 } });
  assert.ok(typeof t !== 'string');
  assert.equal(t.title, 'X Y');
  assert.equal(t.bpm, undefined);
  assert.equal(t.mode, undefined);
  assert.equal(t.tab, undefined);
  assert.equal(t.strudel, 'x.strudel.js');
  assert.equal(t.evil, undefined);
  assert.equal(typeof validateTrack({ folder: '../x' }), 'string');
});

test('import detection: library, track.json, tab.json, setlist, junk', () => {
  const track = readFileSync(join(import.meta.dirname, '..', '..', 'assets', 'glsl', 'hexbolt', 'track.json'), 'utf8');
  assert.equal(detectImport(track).kind, 'track');
  assert.equal(detectImport(readFileSync(REPO_TAB, 'utf8')).kind, 'tab');
  assert.equal(detectImport(readFileSync(join(import.meta.dirname, '..', '..', 'assets', 'nmn.json'), 'utf8')).kind, 'setlist');
  assert.equal(detectImport(exportLibrary(emptyLibrary())).kind, 'library');
  assert.equal(detectImport('nope').kind, 'unknown');
  assert.equal(detectImport('[1,2]').kind, 'unknown');
  assert.equal(detectImport('{"hello":1}').kind, 'unknown');
});

test('library: tracks, setlists, export round trip, single files', () => {
  let { library: lib, track } = addTrack(emptyLibrary(), 'Hex Bolt', { bpm: 136 });
  assert.equal(track.folder, 'hexbolt');
  ({ library: lib } = addTrack(lib, 'Hex Bolt'));
  assert.equal(lib.tracks[1].folder, 'hexbolt-2');
  lib = setTab(lib, 'hexbolt', setNote(lib.tabs.hexbolt, { beat: 0, string: 0, fret: 2, dur: 1 }));
  let name: string;
  ({ library: lib, name } = addSetlist(lib, 'Mon set'));
  lib = addToSetlist(lib, name, { title: 'Hex Bolt', folder: 'hexbolt' });
  lib = addToSetlist(lib, name, { title: 'Hex Bolt 2', folder: 'hexbolt-2' });
  lib = moveInSetlist(lib, name, 1, -1);
  assert.deepEqual(lib.setlists[0].tracks.map((r) => r.folder), ['hexbolt-2', 'hexbolt']);
  lib = moveInSetlist(lib, name, 0, -1); // nothing above
  assert.deepEqual(lib.setlists[0].tracks.map((r) => r.folder), ['hexbolt-2', 'hexbolt']);
  lib = renameSetlist(lib, name, 'Set 2');
  assert.equal(lib.setlists[0].title, 'Set 2');

  const back = detectImport(exportLibrary(lib));
  assert.equal(back.kind, 'library');
  if (back.kind === 'library') { assert.deepEqual(back.library, lib); assert.equal(back.skipped, 0); }

  const tj = JSON.parse(exportTrack(lib, 'hexbolt')!);
  assert.equal(tj.tabFile, 'hexbolt.tab.json');
  assert.deepEqual(tj.tab, { tuning: 'EADG' });
  const tab = detectImport(exportTab(lib, 'hexbolt')!);
  assert.equal(tab.kind, 'tab');
  if (tab.kind === 'tab') assertValidTab(tab.tab);
  assert.equal(detectImport(exportSetlist(lib, name)!).kind, 'setlist');

  lib = removeFromSetlist(lib, name, 0);
  lib = deleteTrack(lib, 'hexbolt');
  assert.deepEqual(lib.setlists[0].tracks, []);
  assert.equal(lib.tabs.hexbolt, undefined);
  assert.equal(slug('Élan Vital!'), 'elanvital');
});

test('merge: new items added, conflicts replaced or kept both (setlists follow renamed tracks)', () => {
  let { library: mine } = addTrack(emptyLibrary(), 'Song', { bpm: 100 });
  ({ library: mine } = addSetlist(mine, 'Set'));
  let { library: theirs } = addTrack(emptyLibrary(), 'Song', { bpm: 140 });
  ({ library: theirs } = addTrack(theirs, 'Other'));
  ({ library: theirs } = addSetlist(theirs, 'Set'));
  theirs = addToSetlist(theirs, 'set', { title: 'Song', folder: 'song' });
  assert.deepEqual(conflicts(mine, theirs), { tracks: ['song'], setlists: ['set'], sketches: [] });
  assert.deepEqual(conflicts(mine, mine), { tracks: [], setlists: [], sketches: [] });

  const r = merge(mine, theirs, 'replace');
  assert.equal(r.library.tracks.find((t) => t.folder === 'song')!.bpm, 140);
  assert.equal(r.library.tracks.length, 2);
  assert.deepEqual([r.added, r.replaced, r.renamed], [1, 2, 0]);

  const k = merge(mine, theirs, 'keep');
  assert.deepEqual(k.library.tracks.map((t) => t.folder), ['song', 'song-2', 'other']);
  assert.equal(k.library.tracks.find((t) => t.folder === 'song')!.bpm, 100);
  assert.ok(k.library.tabs['song-2']);
  const kept = k.library.setlists.find((s) => s.name === 'set-2')!;
  assert.deepEqual(kept.tracks, [{ title: 'Song', folder: 'song-2' }]);
});

test('public index: validated, bad entries dropped, tracks saved into the library', () => {
  const c = validateIndex(JSON.parse(readFileSync(join(FIX, 'index.json'), 'utf8')), 'https://x/library/');
  assert.ok(c);
  assert.deepEqual(c.artists.map((a) => a.id), ['batchass']);
  assert.deepEqual(c.artists[0].links.map((l) => l.platform), ['Spotify']);
  assert.equal(c.about?.logo, undefined); // "../secret.png"
  assert.deepEqual(c.tracks.map((t) => t.folder), ['demo', 'odd']);
  assert.equal(c.tracks[0].tabPath, 'tabs/demo.tab.json');
  assert.equal(c.tracks[0].patchPath, 'patches/demo.strudel.js');
  assert.equal(c.tracks[0].shaderPath, 'shaders/demo.glsl');
  // paths outside patches/ and shaders/ dropped, and never kept as plain fields
  const odd = c.tracks[1];
  assert.equal(odd.patchPath, undefined);
  assert.equal(odd.shaderPath, undefined);
  assert.equal('patch' in odd || 'shader' in odd, false);
  // what the Workshop keeps for offline reads back the same
  assert.deepEqual(validateIndex({ app: 'videodromm-library', version: 1, tracks: c.tracks.map(toIndexTrack) }, '')!.tracks, c.tracks);
  const t = toLibraryTrack(c.tracks[0], newTab({ source: 'x', tempo: 120 }));
  assert.equal(t.tabFile, 'demo.tab.json');
  assert.equal('tabPath' in t || 'patchPath' in t || 'shaderPath' in t, false);
  assert.equal(validateIndex({ app: 'other' }, ''), undefined);
  assert.deepEqual(librarySources({ nativeServer: '192.168.1.5' }), ['http://192.168.1.5:5191/api/library/', 'https://assets.batchass.fr/library/']);
  assert.deepEqual(librarySources({ pageIsLan: true }), ['./api/library/', 'https://assets.batchass.fr/library/']);
  assert.deepEqual(librarySources({}), ['https://assets.batchass.fr/library/']);
});

test('fretboard: roots, scale notes, degrees, guitar strings', () => {
  const rows = fretRows(INSTRUMENTS.bass4.tunings.EADG, 4, 'minor', 12, 'names');
  assert.equal(rows.length, 4);
  assert.equal(rows[3][0].label, 'E'); // the low E, last row
  assert.ok(rows[3][0].root);
  assert.ok(rows[3][2].inScale); // F#
  assert.ok(!rows[3][1].inScale); // F
  assert.equal(rows[0].length, 13);
  const deg = fretRows(INSTRUMENTS.guitar.tunings.DADGAD, 2, 'major', 24, 'degrees');
  assert.equal(deg[5][0].label, '1');
  assert.equal(deg[0][25 - 1].fret, 24);
  assert.deepEqual(stringNames(INSTRUMENTS.bass5.tunings.BEADG), ['G', 'D', 'A', 'E', 'B']);
});

test('/api/library: files served read only, paths checked', async () => {
  assert.equal(libraryFile(FIX, '../index.json'), undefined);
  assert.equal(libraryFile(FIX, '..%2Findex.json'), undefined);
  assert.equal(libraryFile(FIX, 'tabs/demo.js'), undefined);
  assert.equal(libraryFile(FIX, 'a b.json'), undefined);
  assert.ok(libraryFile(FIX, 'tabs/demo.tab.json'));
  const server = createServer((req, res) => { if (!handleLibrary(FIX, req, res)) res.writeHead(404).end(); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/library/`;
  try {
    const index = await fetch(`${base}index.json`);
    assert.equal(index.status, 200);
    assert.equal(index.headers.get('access-control-allow-origin'), '*');
    assert.equal((await index.json()).app, 'videodromm-library');
    const patch = await fetch(`${base}patches/demo.strudel.js`);
    assert.equal(patch.headers.get('content-type'), 'text/plain; charset=utf-8'); // never a script
    assert.match(await patch.text(), /setcpm/);
    assert.equal((await fetch(`${base}shaders/demo.glsl`)).status, 200);
    const png = await fetch(`${base}artists/batchass.png`);
    assert.equal(png.headers.get('content-type'), 'image/png');
    assert.equal((await fetch(`${base}tabs/none.tab.json`)).status, 404);
    assert.equal((await fetch(`${base}..%2F..%2Fpackage.json`)).status, 400);
    assert.equal((await fetch(`${base}index.json`, { method: 'POST' })).status, 405);
  } finally {
    server.close();
  }
});
