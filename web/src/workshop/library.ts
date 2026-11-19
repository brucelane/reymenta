// The Workshop's library (studies/reymenta-workshop.md step 3): the user's setlists, tracks and bass tabs, in the
// repo's own formats so any exported file can be dropped into c:\repos\assets and opened by the WebApp:
// - a track = assets/glsl/<folder>/track.json (id, project, title, folder, tonality, mode, bpm, tabFile, tab.tuning...);
// - a tab = <folder>.tab.json (TabData, tabEdit.ts);
// - a setlist = assets/<name>.json ({name, title, project, tracks: [{title, folder}]});
// - a patch = <folder>.strudel.js (Strudel code, step 4);
// - a drum tab = drums.ts DrumTab (the Workshop's own format, step 4);
// - a Hydra sketch = <folder>.hydra.js (Hydra code, step 5), and free sketches (hydra.ts Sketch, not tied to a track);
// - the whole library = {app: "videodromm-library", version: 1, setlists, tracks, tabs: {<folder>: TabData},
//   patches: {<folder>: code}, drums: {<folder>: DrumTab}, hydra: {<folder>: code}, sketches: [Sketch]}
//   (patches, drums, hydra and sketches optional: older files have none).
// Everything imported is untrusted: validated here (types, sizes, string lengths). Pure functions, no DOM.
import { isModeName } from '../../../src/core/scales';
import { validateDrumTab, type DrumTab } from './drums';
import { MAX_SKETCHES, validateHydra, validateSketch, type Sketch } from './hydra';
import { validatePatch } from './patch';
import { isTuning, newTab, validateTab, type WTab } from './tabEdit';

export interface TrackRef { title: string; folder: string }
export interface Setlist { name: string; title: string; project: string; tracks: TrackRef[] }
export interface Link { platform: string; url: string }
export interface Track {
  id: string;
  folder: string;
  title: string;
  project?: string;
  description?: string;
  tonality?: string;
  mode?: string;
  bpm?: number;
  /** beats per bar (the Workshop's; the tab's song.cycleBeats says the same) */
  beatsPerBar?: number;
  tabFile?: string;
  tab?: { tuning?: string };
  /** the public library's artist id (batchass, brucelane, reymenta) */
  artist?: string;
  links?: Link[];
  updatedAt?: string;
  /** other track.json fields (strudel, als, audio...), kept as they are */
  [key: string]: unknown;
}
export interface Library {
  app: 'videodromm-library';
  version: 1;
  setlists: Setlist[];
  tracks: Track[];
  tabs: Record<string, WTab>;
  /** Strudel patches by folder */
  patches: Record<string, string>;
  /** drum tabs by folder */
  drums: Record<string, DrumTab>;
  /** Hydra sketches by folder (step 5) */
  hydra: Record<string, string>;
  /** free Hydra sketches (not tied to a track) */
  sketches: Sketch[];
  /** the public catalogue's patch as it was copied, for "revert to the original" (kept on the phone, not exported) */
  originals: Record<string, string>;
}

export const LIBRARY_APP = 'videodromm-library';
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_ITEMS = 5000;

export const emptyLibrary = (): Library => ({ app: LIBRARY_APP, version: 1, setlists: [], tracks: [], tabs: {}, patches: {}, drums: {}, hydra: {}, sketches: [], originals: {} });

// ---------------------------------------------------------------- validation

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max = 200): v is string => typeof v === 'string' && v.length <= max;
const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const oneLine = (s: string, max: number) => s.replace(/[\r\n\t\u2028\u2029]+/g, ' ').trim().slice(0, max);

/** A folder name as the WebApp accepts them (lib/folderSync.ts): letters, digits, space, _ . -, no "..". */
export const isFolder = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9 _.-]{1,64}$/.test(v) && !v.includes('..') && v.trim() === v;

export function validateLinks(v: unknown): Link[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((l): l is Link => obj(l) && str(l.platform, 40) && str(l.url, 500) && /^https:\/\//.test(l.url as string))
    .slice(0, 20).map((l) => ({ platform: oneLine(l.platform, 40), url: l.url }));
}

const KNOWN = new Set(['id', 'folder', 'title', 'project', 'description', 'tonality', 'mode', 'bpm', 'beatsPerBar', 'tabFile', 'tab', 'artist', 'links', 'updatedAt']);

/** A track.json (or a library track) -> a clean Track, or an error. */
export function validateTrack(raw: unknown): Track | string {
  if (!obj(raw)) return 'not an object';
  // no folder: the id names it (older track.json files); a folder given but invalid: refused
  const folder = raw.folder === undefined ? (isFolder(raw.id) ? raw.id : undefined) : isFolder(raw.folder) ? raw.folder : undefined;
  if (!folder) return 'no valid folder';
  const t: Track = {
    id: isFolder(raw.id) ? raw.id : folder,
    folder,
    title: str(raw.title) && raw.title.trim() ? oneLine(raw.title, 120) : folder,
  };
  if (str(raw.project, 16)) t.project = oneLine(raw.project, 16);
  if (str(raw.description, 2000)) t.description = raw.description;
  if (str(raw.tonality, 32)) t.tonality = raw.tonality;
  if (isModeName(raw.mode)) t.mode = raw.mode;
  if (num(raw.bpm, 1, 999)) t.bpm = raw.bpm;
  if (num(raw.beatsPerBar, 0.5, 64)) t.beatsPerBar = raw.beatsPerBar;
  if (str(raw.tabFile, 100) && /^[\w .-]+\.tab\.json$/.test(raw.tabFile)) t.tabFile = raw.tabFile;
  // track.json: tab = {tuning}; the public index: tab = "tabs/<folder>.tab.json" (read by the catalogue, not kept)
  if (obj(raw.tab) && isTuning(raw.tab.tuning)) t.tab = { tuning: raw.tab.tuning };
  if (str(raw.artist, 40) && /^[a-z0-9-]+$/.test(raw.artist)) t.artist = raw.artist;
  const links = validateLinks(raw.links);
  if (links?.length) t.links = links;
  if (str(raw.updatedAt, 40)) t.updatedAt = raw.updatedAt;
  // other plain fields (strudel, als, audio, audienceEmojis...): kept so a round trip loses nothing
  let extra = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (KNOWN.has(k) || !/^[A-Za-z][\w]{0,39}$/.test(k) || k === '__proto__' || extra >= 40) continue;
    if (str(v, 2000) || num(v, -1e9, 1e9) || typeof v === 'boolean') { t[k] = v; extra++; }
  }
  return t;
}

/** A setlist json -> a clean Setlist, or an error. */
export function validateSetlist(raw: unknown): Setlist | string {
  if (!obj(raw)) return 'not an object';
  if (!str(raw.name, 64) || !/^[\w .-]{1,64}$/.test(raw.name)) return 'bad name';
  if (!Array.isArray(raw.tracks) || raw.tracks.length > 500) return 'bad tracks';
  const tracks: TrackRef[] = [];
  for (const r of raw.tracks) {
    if (!obj(r) || !isFolder(r.folder)) return 'bad track entry';
    tracks.push({ folder: r.folder, title: str(r.title) && r.title.trim() ? oneLine(r.title, 120) : r.folder });
  }
  return {
    name: raw.name,
    title: str(raw.title) && raw.title.trim() ? oneLine(raw.title, 120) : raw.name,
    project: str(raw.project, 16) ? oneLine(raw.project, 16) : '',
    tracks,
  };
}

/** A library file -> a clean Library (invalid items skipped and counted), or an error. */
export function validateLibrary(raw: unknown): { library: Library; skipped: number } | string {
  if (!obj(raw) || raw.app !== LIBRARY_APP) return 'not a library file';
  if (raw.version !== 1) return 'unknown library version';
  const lib = emptyLibrary();
  let skipped = 0;
  const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, MAX_ITEMS) : []);
  for (const s of list(raw.setlists)) {
    const v = validateSetlist(s);
    if (typeof v === 'string' || lib.setlists.some((x) => x.name === v.name)) skipped++;
    else lib.setlists.push(v);
  }
  for (const t of list(raw.tracks)) {
    const v = validateTrack(t);
    if (typeof v === 'string' || lib.tracks.some((x) => x.folder === v.folder)) skipped++;
    else lib.tracks.push(v);
  }
  if (obj(raw.tabs)) {
    for (const [folder, tab] of Object.entries(raw.tabs).slice(0, MAX_ITEMS)) {
      const v = isFolder(folder) ? validateTab(tab) : 'bad folder';
      if (typeof v === 'string') skipped++;
      else lib.tabs[folder] = v;
    }
  }
  for (const key of ['patches', 'originals'] as const) {
    if (!obj(raw[key])) continue;
    for (const [folder, code] of Object.entries(raw[key] as Record<string, unknown>).slice(0, MAX_ITEMS)) {
      const v = isFolder(folder) ? validatePatch(code) : { error: 'bad folder' };
      if (typeof v !== 'string') skipped++;
      else lib[key][folder] = v;
    }
  }
  if (obj(raw.drums)) {
    for (const [folder, d] of Object.entries(raw.drums).slice(0, MAX_ITEMS)) {
      const v = isFolder(folder) ? validateDrumTab(d) : 'bad folder';
      if (typeof v === 'string') skipped++;
      else lib.drums[folder] = v;
    }
  }
  if (obj(raw.hydra)) {
    for (const [folder, code] of Object.entries(raw.hydra).slice(0, MAX_ITEMS)) {
      const v = isFolder(folder) ? validateHydra(code) : { error: 'bad folder' };
      if (typeof v !== 'string') skipped++;
      else lib.hydra[folder] = v;
    }
  }
  for (const s of (Array.isArray(raw.sketches) ? raw.sketches.slice(0, MAX_SKETCHES) : [])) {
    const v = validateSketch(s);
    if (typeof v === 'string' || lib.sketches.some((x) => x.id === v.id)) skipped++;
    else lib.sketches.push(v);
  }
  return { library: lib, skipped };
}

// ---------------------------------------------------------------- import detection

export type Detected =
  | { kind: 'library'; library: Library; skipped: number }
  | { kind: 'track'; track: Track }
  | { kind: 'tab'; tab: WTab }
  | { kind: 'setlist'; setlist: Setlist }
  | { kind: 'unknown'; error: string };

/** What a dropped JSON file is: a whole library, a track.json, a tab.json or a setlist. */
export function detectImport(text: string): Detected {
  if (text.length > MAX_FILE_BYTES) return { kind: 'unknown', error: 'file too large' };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { kind: 'unknown', error: 'not JSON' }; }
  if (!obj(raw)) return { kind: 'unknown', error: 'not a JSON object' };
  const fail = (e: string): Detected => ({ kind: 'unknown', error: e });
  if (raw.app === LIBRARY_APP) {
    const v = validateLibrary(raw);
    return typeof v === 'string' ? fail(v) : { kind: 'library', ...v };
  }
  if (raw.version === 1 && obj(raw.song) && 'tuning' in raw) {
    const v = validateTab(raw);
    return typeof v === 'string' ? fail(`tab: ${v}`) : { kind: 'tab', tab: v };
  }
  if (Array.isArray(raw.tracks) && typeof raw.name === 'string') {
    const v = validateSetlist(raw);
    return typeof v === 'string' ? fail(`setlist: ${v}`) : { kind: 'setlist', setlist: v };
  }
  if ('folder' in raw || ('id' in raw && ('title' in raw || 'bpm' in raw))) {
    const v = validateTrack(raw);
    return typeof v === 'string' ? fail(`track: ${v}`) : { kind: 'track', track: v };
  }
  return fail('unknown file');
}

// ---------------------------------------------------------------- merge

export type MergeChoice = 'replace' | 'keep';

// key order doesn't count (a validated track lists its fields in its own order)
const stable = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, stable(x)])) : v;
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a)) === JSON.stringify(stable(b));

/** What travels with a track: its tab, patch, drum tab and Hydra sketch (each optional). */
const PARTS = ['tabs', 'patches', 'drums', 'hydra'] as const;
type Part = (typeof PARTS)[number];
/** an incoming part that would overwrite a different one of mine */
const partDiffers = (lib: Library, incoming: Partial<Library>, folder: string, k: Part) => {
  const theirs = incoming[k]?.[folder];
  const mine = lib[k][folder];
  return theirs !== undefined && mine !== undefined && !same(mine, theirs);
};
const partsSame = (lib: Library, incoming: Partial<Library>, folder: string) =>
  PARTS.every((k) => incoming[k]?.[folder] === undefined || same(lib[k][folder], incoming[k]![folder]));

/** Items of `incoming` that would overwrite different items of `lib` (identical ones don't count). */
export function conflicts(lib: Library, incoming: Partial<Library>): { tracks: string[]; setlists: string[]; sketches: string[] } {
  const tracks = (incoming.tracks ?? []).filter((t) => {
    const mine = lib.tracks.find((x) => x.folder === t.folder);
    return mine && (!same(mine, t) || PARTS.some((k) => partDiffers(lib, incoming, t.folder, k)));
  }).map((t) => t.folder);
  const setlists = (incoming.setlists ?? []).filter((s) => {
    const mine = lib.setlists.find((x) => x.name === s.name);
    return mine && !same(mine, s);
  }).map((s) => s.name);
  const sketches = (incoming.sketches ?? []).filter((s) => {
    const mine = lib.sketches.find((x) => x.id === s.id);
    return mine && !same(mine, s);
  }).map((s) => s.title);
  return { tracks, setlists, sketches };
}

/** `base`, else base-2, base-3... not in `taken`. */
export function uniqueName(base: string, taken: (n: string) => boolean): string {
  if (!taken(base)) return base;
  const stem = base.replace(/-\d+$/, '').slice(0, 58);
  for (let i = 2; ; i++) if (!taken(`${stem}-${i}`)) return `${stem}-${i}`;
}

/** A folder name from a title: "Hex Bolt" -> "hexbolt" (the repo's folders are lower case, no spaces). */
export function slug(title: string, fallback = 'track'): string {
  const s = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 48);
  return s || fallback;
}

/**
 * Merges `incoming` into `lib`. On a conflict, "replace" takes the incoming item, "keep" keeps both: the incoming
 * one gets a new folder/name (foo-2), and the incoming setlists follow their renamed tracks.
 */
export function merge(lib: Library, incoming: Partial<Library>, choice: MergeChoice): { library: Library; added: number; replaced: number; renamed: number } {
  const out: Library = {
    ...lib, setlists: [...lib.setlists], tracks: [...lib.tracks],
    tabs: { ...lib.tabs }, patches: { ...lib.patches }, drums: { ...lib.drums }, hydra: { ...lib.hydra },
    sketches: [...lib.sketches], originals: { ...lib.originals },
  };
  let added = 0, replaced = 0, renamed = 0;
  const rename = new Map<string, string>();
  const inTracks = incoming.tracks ?? [];
  // the incoming track's tab / patch / drums, under `to`
  const copyParts = (from: string, to: string) => {
    for (const k of PARTS) {
      const v = incoming[k]?.[from];
      if (v !== undefined) (out[k] as Record<string, unknown>)[to] = v;
    }
  };
  for (const t of inTracks) {
    const at = out.tracks.findIndex((x) => x.folder === t.folder);
    if (at < 0) { out.tracks.push(t); copyParts(t.folder, t.folder); added++; continue; }
    const mine = out.tracks[at];
    if (same(mine, t) && partsSame(out, incoming, t.folder)) continue;
    if (choice === 'replace') {
      out.tracks[at] = t;
      copyParts(t.folder, t.folder);
      replaced++;
    } else {
      const folder = uniqueName(t.folder, (f) => out.tracks.some((x) => x.folder === f) || inTracks.some((x) => x !== t && x.folder === f));
      rename.set(t.folder, folder);
      out.tracks.push({ ...t, id: folder, folder, ...(t.tabFile ? { tabFile: `${folder}.tab.json` } : {}) });
      copyParts(t.folder, folder);
      renamed++;
    }
  }
  // parts with no track in the incoming file (a library with a tab whose track is already mine)
  for (const k of PARTS) {
    for (const [folder, v] of Object.entries(incoming[k] ?? {})) {
      if (inTracks.some((t) => t.folder === folder)) continue;
      if ((out[k] as Record<string, unknown>)[folder] === undefined || choice === 'replace') (out[k] as Record<string, unknown>)[folder] = v;
    }
  }
  for (const s0 of incoming.setlists ?? []) {
    const s = { ...s0, tracks: s0.tracks.map((r) => ({ ...r, folder: rename.get(r.folder) ?? r.folder })) };
    const at = out.setlists.findIndex((x) => x.name === s.name);
    if (at < 0) { out.setlists.push(s); added++; continue; }
    if (same(out.setlists[at], s)) continue;
    if (choice === 'replace') { out.setlists[at] = s; replaced++; }
    else {
      const name = uniqueName(s.name, (n) => out.setlists.some((x) => x.name === n));
      out.setlists.push({ ...s, name });
      renamed++;
    }
  }
  for (const k of incoming.sketches ?? []) {
    const at = out.sketches.findIndex((x) => x.id === k.id);
    if (at < 0) { out.sketches.push(k); added++; continue; }
    if (same(out.sketches[at], k)) continue;
    if (choice === 'replace') { out.sketches[at] = k; replaced++; }
    else {
      out.sketches.push({ ...k, id: uniqueName(k.id, (n) => out.sketches.some((x) => x.id === n)) });
      renamed++;
    }
  }
  return { library: out, added, replaced, renamed };
}

// ---------------------------------------------------------------- tracks

/** A new track in the library (with an empty tab), its folder made from the title. */
export function addTrack(lib: Library, title: string, o: { bpm?: number; tuning?: string; beatsPerBar?: number } = {}): { library: Library; track: Track } {
  const clean = oneLine(title, 120) || 'Track';
  const folder = uniqueName(slug(clean), (f) => lib.tracks.some((t) => t.folder === f));
  const bpm = o.bpm ?? 120;
  const tuning = isTuning(o.tuning) ? o.tuning : 'EADG';
  const track: Track = {
    id: folder, folder, title: clean, bpm, beatsPerBar: o.beatsPerBar ?? 4, tonality: 'E', mode: 'minor',
    tabFile: `${folder}.tab.json`, tab: { tuning }, updatedAt: new Date().toISOString(),
  };
  const tab = newTab({ source: `${folder}.workshop`, tempo: bpm, beatsPerBar: track.beatsPerBar, tuning });
  return { library: { ...lib, tracks: [...lib.tracks, track], tabs: { ...lib.tabs, [folder]: tab } }, track };
}

/** A track's changes; its tab follows (tempo, tuning, beats per bar). */
export function updateTrack(lib: Library, folder: string, change: Partial<Track>): Library {
  const tracks = lib.tracks.map((t) => (t.folder === folder ? { ...t, ...change, id: t.id, folder: t.folder, updatedAt: new Date().toISOString() } : t));
  return { ...lib, tracks };
}

/** A track's patch (code); an empty text removes it. */
export function setPatch(lib: Library, folder: string, code: string): Library {
  const patches = { ...lib.patches };
  if (code.trim()) patches[folder] = code;
  else delete patches[folder];
  return { ...lib, patches };
}

/** A track's Hydra sketch; an empty text removes it. */
export function setHydra(lib: Library, folder: string, code: string): Library {
  const hydra = { ...lib.hydra };
  if (code.trim()) hydra[folder] = code;
  else delete hydra[folder];
  return { ...lib, hydra };
}

/** A new free sketch (its id from the title), with `code`. */
export function addSketch(lib: Library, title: string, code: string): { library: Library; sketch: Sketch } {
  const clean = oneLine(title, 120) || 'Sketch';
  const id = uniqueName(slug(clean, 'sketch'), (n) => lib.sketches.some((s) => s.id === n));
  const sketch: Sketch = { id, title: clean, code, updatedAt: new Date().toISOString() };
  return { library: { ...lib, sketches: [...lib.sketches, sketch] }, sketch };
}

/** A free sketch's code or title. */
export const updateSketch = (lib: Library, id: string, change: { code?: string; title?: string }): Library => ({
  ...lib,
  sketches: lib.sketches.map((s) => (s.id === id ? {
    ...s, ...(change.code !== undefined ? { code: change.code } : {}),
    ...(change.title !== undefined ? { title: oneLine(change.title, 120) || s.title } : {}), updatedAt: new Date().toISOString(),
  } : s)),
});

export const deleteSketch = (lib: Library, id: string): Library => ({ ...lib, sketches: lib.sketches.filter((s) => s.id !== id) });

/** The public patch as copied (for "revert to the original"). */
export const setOriginal = (lib: Library, folder: string, code: string): Library => ({ ...lib, originals: { ...lib.originals, [folder]: code } });

/** A track's drum tab; undefined removes it. */
export function setDrums(lib: Library, folder: string, drums: DrumTab | undefined): Library {
  const all = { ...lib.drums };
  if (drums) all[folder] = drums;
  else delete all[folder];
  return { ...lib, drums: all };
}

export function setTab(lib: Library, folder: string, tab: WTab): Library {
  const tracks = lib.tracks.map((t) => (t.folder === folder ? { ...t, tabFile: `${folder}.tab.json`, tab: { ...t.tab, tuning: tab.tuning } } : t));
  return { ...lib, tracks, tabs: { ...lib.tabs, [folder]: tab } };
}

/** Deletes a track, its tab, patch and drums, and its place in my setlists. */
export function deleteTrack(lib: Library, folder: string): Library {
  const without = <T,>(m: Record<string, T>) => { const c = { ...m }; delete c[folder]; return c; };
  return {
    ...lib, tabs: without(lib.tabs), patches: without(lib.patches), drums: without(lib.drums), hydra: without(lib.hydra),
    originals: without(lib.originals),
    tracks: lib.tracks.filter((t) => t.folder !== folder),
    setlists: lib.setlists.map((s) => ({ ...s, tracks: s.tracks.filter((r) => r.folder !== folder) })),
  };
}

// ---------------------------------------------------------------- setlists

export function addSetlist(lib: Library, title: string): { library: Library; name: string } {
  const clean = oneLine(title, 120) || 'Setlist';
  const name = uniqueName(slug(clean, 'setlist'), (n) => lib.setlists.some((s) => s.name === n));
  return { library: { ...lib, setlists: [...lib.setlists, { name, title: clean, project: '', tracks: [] }] }, name };
}

const editSetlist = (lib: Library, name: string, f: (s: Setlist) => Setlist): Library =>
  ({ ...lib, setlists: lib.setlists.map((s) => (s.name === name ? f(s) : s)) });

export const renameSetlist = (lib: Library, name: string, title: string) =>
  editSetlist(lib, name, (s) => ({ ...s, title: oneLine(title, 120) || s.title }));

export const deleteSetlist = (lib: Library, name: string): Library => ({ ...lib, setlists: lib.setlists.filter((s) => s.name !== name) });

export const addToSetlist = (lib: Library, name: string, ref: TrackRef) =>
  editSetlist(lib, name, (s) => ({ ...s, tracks: [...s.tracks, { title: oneLine(ref.title, 120) || ref.folder, folder: ref.folder }] }));

export const removeFromSetlist = (lib: Library, name: string, index: number) =>
  editSetlist(lib, name, (s) => ({ ...s, tracks: s.tracks.filter((_, i) => i !== index) }));

/** Moves entry `index` by `by` (-1 up, +1 down); nothing at the ends. */
export const moveInSetlist = (lib: Library, name: string, index: number, by: -1 | 1) =>
  editSetlist(lib, name, (s) => {
    const to = index + by;
    if (index < 0 || to < 0 || index >= s.tracks.length || to >= s.tracks.length) return s;
    const tracks = [...s.tracks];
    [tracks[index], tracks[to]] = [tracks[to], tracks[index]];
    return { ...s, tracks };
  });

// ---------------------------------------------------------------- export

/** The whole library as one file. */
export const exportLibrary = (lib: Library): string =>
  JSON.stringify({
    app: LIBRARY_APP, version: 1, setlists: lib.setlists, tracks: lib.tracks, tabs: lib.tabs, patches: lib.patches, drums: lib.drums,
    hydra: lib.hydra, sketches: lib.sketches,
  }, null, 1);

/** <folder>.strudel.js */
export const exportPatch = (lib: Library, folder: string): string | undefined => lib.patches[folder];

/** <folder>.hydra.js */
export const exportHydra = (lib: Library, folder: string): string | undefined => lib.hydra[folder];

/** track.json as in assets/glsl/<folder>/ (tabFile + tab.tuning when it has a tab). */
export function exportTrack(lib: Library, folder: string): string | undefined {
  const t = lib.tracks.find((x) => x.folder === folder);
  if (!t) return undefined;
  const tab = lib.tabs[folder];
  const out: Track = { ...t };
  if (tab) { out.tabFile = `${folder}.tab.json`; out.tab = { ...t.tab, tuning: tab.tuning }; }
  return JSON.stringify(out, null, 2) + '\n';
}

/** <folder>.tab.json as the WebApp's Track pane reads it. */
export function exportTab(lib: Library, folder: string): string | undefined {
  const tab = lib.tabs[folder];
  return tab ? JSON.stringify(tab) + '\n' : undefined;
}

/** assets/<name>.json */
export function exportSetlist(lib: Library, name: string): string | undefined {
  const s = lib.setlists.find((x) => x.name === name);
  return s ? JSON.stringify(s, null, 2) + '\n' : undefined;
}
