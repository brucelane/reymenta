// The Workshop's bass tab (studies/reymenta-workshop.md step 3): a TabData exactly like <folder>.tab.json in assets
// (WebApp lib/songGrid.ts, scripts/patch-tab.mjs), edited by hand. The notes live in song.tracks.tabbass; the
// string the user picked for a note is kept in `overrides` keyed by note index (as the WebApp's AlsTab does); `tab`
// (string, fret, finger per note) is always recomputed by fretBass, never trusted from a file.
// Pure functions, no DOM: test/workshop.test.ts.
import {
  computeBars, fretBass, STEPS_PER_BEAT, TUNINGS,
  type AlsNote, type AlsSong, type Bar, type NoteOverride, type TabData, type TabNote, type TuningName,
} from '../../../src/core/songGrid';
import type { TabMsg } from '../../../src/room/protocol';

/** A tab as saved: TabData + `bars`, the number of bars drawn (empty bars at the end have no note to count them).
 *  The WebApp ignores `bars`. */
export type WTab = TabData & { bars?: number };

export const TUNING_NAMES = Object.keys(TUNINGS) as TuningName[];
export const isTuning = (t: unknown): t is TuningName => typeof t === 'string' && (TUNING_NAMES as string[]).includes(t);

/** Note lengths the editor offers, in beats (1/16, 1/8, 1/4, 1/2, whole). */
export const LENGTHS = [0.25, 0.5, 1, 2, 4];

/** The user's bass range (assets/bruce/README.md "My bass: range and technique"): E1 (open E) to D3. */
export const LOW_KEY = 28;
export const HIGH_KEY = 50;

const r4 = (x: number) => Math.round(x * 10000) / 10000;
const q16 = (beat: number) => Math.round(beat * STEPS_PER_BEAT) / STEPS_PER_BEAT;

/** An empty tab for a new track: 4/4 (or `beatsPerBar`), `bars` empty bars. */
export function newTab(o: { source: string; tempo: number; beatsPerBar?: number; tuning?: TuningName; bars?: number }): WTab {
  const bpb = o.beatsPerBar ?? 4;
  const song: AlsSong = {
    source: o.source, tempo: o.tempo, locators: [], tracks: { tabbass: [] }, clipStarts: [0], audioFile: '', audioStart: 0,
    cycleBeats: bpb, ...(bpb !== 4 ? { barBeats: [bpb] } : {}),
  };
  return refresh({ version: 1, source: o.source, tuning: o.tuning ?? 'EADG', overrides: {}, song, tab: [], bars: o.bars ?? 4 });
}

/** Recomputed frets/fingers (the `tab` field) and the bar count. */
export function refresh(t: WTab): WTab {
  const notes = t.song.tracks.tabbass ?? [];
  const tab = fretBass(notes, t.tuning, t.overrides).map(({ beat, dur, key, string, fret, finger }) => ({ beat, dur, key, string, fret, finger }));
  const next: WTab = { ...t, tab };
  next.bars = Math.max(1, t.bars ?? 0, rawBars(next).length);
  return next;
}

/** The computed tab with every field (playedKey, overrides...), same order as the notes. */
export function fretted(t: WTab): TabNote[] {
  return fretBass(t.song.tracks.tabbass ?? [], t.tuning, t.overrides);
}

const rawBars = (t: WTab): Bar[] => ((t.song.tracks.tabbass ?? []).length || t.song.barBeats?.length ? computeBars(t.song) : []);

/** The bars the editor shows: the song's bars, then empty bars up to `bars`. */
export function editorBars(t: WTab): Bar[] {
  const bars = rawBars(t).map((b) => ({ ...b, sections: [...b.sections] }));
  const pattern = t.song.barBeats?.length ? t.song.barBeats : [t.song.cycleBeats ?? 4];
  while (bars.length < (t.bars ?? 1)) {
    const last = bars[bars.length - 1];
    const start = last ? last.start + last.beats : 0;
    bars.push({ index: bars.length, start, beats: pattern[bars.length % pattern.length], sections: [] });
  }
  // sections of empty bars (computeBars only names the bars it made)
  for (const l of t.song.locators) {
    const b = bars.find((x) => l.beat >= x.start - 1e-6 && l.beat < x.start + x.beats - 1e-6);
    const name = l.name.replace(/^#/, '');
    if (b && !b.sections.includes(name)) b.sections.push(name);
  }
  return bars;
}

interface Entry { note: AlsNote; ov?: NoteOverride }

const entries = (t: WTab): Entry[] => (t.song.tracks.tabbass ?? []).map((note, i) => ({ note, ov: t.overrides[i] }));

/** Back from entries: notes sorted by time (then pitch), the overrides re-keyed to follow their notes. */
function withEntries(t: WTab, list: Entry[], extra: Partial<WTab> = {}): WTab {
  const sorted = list.map((e, i) => ({ ...e, i })).sort((a, b) => a.note.beat - b.note.beat || a.note.key - b.note.key || a.i - b.i);
  const overrides: Record<number, NoteOverride> = {};
  sorted.forEach((e, i) => { if (e.ov && (e.ov.string !== undefined || e.ov.finger !== undefined)) overrides[i] = e.ov; });
  return refresh({ ...t, ...extra, overrides, song: { ...t.song, ...extra.song, tracks: { ...t.song.tracks, tabbass: sorted.map((e) => e.note) } } });
}

/** Index of the note starting at `beat` on `string` (as fretted now), else -1. */
export function noteAt(t: WTab, beat: number, string: number): number {
  return t.tab.findIndex((n) => Math.abs(n.beat - beat) < 1e-6 && n.string === string);
}

/** Puts a note (fret on a string, at a beat, for `dur` beats), replacing the one starting there on that string.
 *  The string is kept as an override, so the automatic fingering can't move it. */
export function setNote(t: WTab, n: { beat: number; string: number; fret: number; dur: number }): WTab {
  const string = Math.max(0, Math.min(3, Math.round(n.string)));
  const fret = Math.max(0, Math.min(24, Math.round(n.fret)));
  const beat = Math.max(0, q16(n.beat));
  const dur = Math.max(0.25, q16(n.dur));
  const at = noteAt(t, beat, string);
  const list = entries(t).filter((_, i) => i !== at);
  const vel = at >= 0 ? (t.song.tracks.tabbass ?? [])[at].vel : 100;
  list.push({ note: { beat: r4(beat), dur: r4(dur), key: TUNINGS[t.tuning][string] + fret, vel }, ov: { string } });
  return withEntries(t, list);
}

export function deleteNote(t: WTab, i: number): WTab {
  return withEntries(t, entries(t).filter((_, j) => j !== i));
}

export function setDuration(t: WTab, i: number, dur: number): WTab {
  return withEntries(t, entries(t).map((e, j) => (j === i ? { ...e, note: { ...e.note, dur: r4(Math.max(0.25, q16(dur))) } } : e)));
}

/** Shifts the notes and sections from `from` on by `by` beats; drops those in [from, from - by) when removing. */
function shift(t: WTab, from: number, by: number, bars: number): WTab {
  const gone = (beat: number) => by < 0 && beat >= from - 1e-6 && beat < from - by - 1e-6;
  const move = (beat: number) => (beat >= from - 1e-6 ? r4(beat + by) : beat);
  const list = entries(t).filter((e) => !gone(e.note.beat)).map((e) => ({ ...e, note: { ...e.note, beat: move(e.note.beat) } }));
  const locators = t.song.locators.filter((l) => !gone(l.beat)).map((l) => ({ ...l, beat: move(l.beat) }));
  const next = withEntries({ ...t, song: { ...t.song, locators }, bars }, list);
  return { ...next, bars: Math.max(1, Math.min(bars, next.bars ?? bars), rawBars(next).length) };
}

/** A bar after bar `after` (-1 = at the start), as long as that bar. */
export function addBar(t: WTab, after: number): WTab {
  const bars = editorBars(t);
  const ref = bars[Math.max(0, Math.min(after, bars.length - 1))];
  const at = after < 0 ? 0 : ref ? ref.start + ref.beats : 0;
  return shift(t, at, ref?.beats ?? 4, bars.length + 1);
}

/** Removes bar `index`, its notes and section names; the following bars move back. */
export function removeBar(t: WTab, index: number): WTab {
  const bars = editorBars(t);
  const bar = bars[index];
  if (!bar || bars.length <= 1) return t;
  return shift(t, bar.start, -bar.beats, bars.length - 1);
}

/** Names the section starting at bar `index` ("" removes it). Saved as a "#name" locator, like the repo's tabs. */
export function setSection(t: WTab, index: number, name: string): WTab {
  const bar = editorBars(t)[index];
  if (!bar) return t;
  const clean = name.replace(/[\r\n\t#]/g, ' ').trim().slice(0, 32);
  const locators = t.song.locators.filter((l) => Math.abs(l.beat - bar.start) > 1e-6);
  if (clean) locators.push({ beat: bar.start, name: `#${clean}` });
  locators.sort((a, b) => a.beat - b.beat);
  return refresh({ ...t, song: { ...t.song, locators } });
}

export function setTuning(t: WTab, tuning: TuningName): WTab {
  return refresh({ ...t, tuning });
}

export function setTempo(t: WTab, tempo: number): WTab {
  return { ...t, song: { ...t.song, tempo } };
}

/** Beats per bar: one cycle = one bar; bars of 4 need no barBeats (patch-tab.mjs does the same). */
export function setBeatsPerBar(t: WTab, bpb: number): WTab {
  const song: AlsSong = { ...t.song, cycleBeats: bpb };
  if (bpb !== 4) song.barBeats = [bpb];
  else delete song.barBeats;
  return refresh({ ...t, song });
}

export type NoteWarning = 'range' | 'open';

/** The user's rules: E1–D3, no open string but the low E. Shown, never enforced. */
export function noteWarnings(n: { key: number; string: number; fret: number }): NoteWarning[] {
  const w: NoteWarning[] = [];
  if (n.key < LOW_KEY || n.key > HIGH_KEY) w.push('range');
  if (n.fret === 0 && n.string > 0) w.push('open');
  return w;
}

/** The compact tab the Show's TabView draws (same shape the audience server sends). */
export function toTabMsg(t: WTab, folder: string, title: string): TabMsg {
  return {
    t: 'tab', f: folder, title,
    bb: t.song.cycleBeats ?? t.song.barBeats?.[0] ?? 4,
    n: t.tab.map((n) => [n.beat, n.string, n.fret, n.dur] as [number, number, number, number]),
    sec: t.song.locators.map((l) => [l.beat, l.name.replace(/^#/, '')] as [number, string]),
    tuning: t.tuning,
  };
}

// ---------------------------------------------------------------- validation (untrusted files)

const num = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export const MAX_NOTES = 20000;

/** A tab.json read from a file or the network -> a clean WTab (only known fields, frets recomputed), or an error. */
export function validateTab(raw: unknown): WTab | string {
  if (!obj(raw)) return 'not an object';
  if (raw.version !== 1) return 'version is not 1';
  if (!isTuning(raw.tuning)) return 'unknown tuning';
  const s = raw.song;
  if (!obj(s)) return 'no song';
  if (!num(s.tempo, 1, 999)) return 'bad tempo';
  const tracks = obj(s.tracks) ? s.tracks : {};
  // every "tab*" part is kept (a tab saved by the WebApp from an Ableton set has the drums too), tabbass edited
  const parts: Record<string, AlsNote[]> = { tabbass: [] };
  let total = 0;
  for (const [name, list] of Object.entries(tracks)) {
    if (!/^tab\w{1,24}$/.test(name) || Object.keys(parts).length > 24) continue;
    if (!Array.isArray(list) || (total += list.length) > MAX_NOTES) return 'bad or too many notes';
    const out: AlsNote[] = [];
    for (const n of list) {
      if (!obj(n) || !num(n.beat, 0, 1e5) || !num(n.dur, 0, 1e4) || !num(n.key, 0, 127)) return 'bad note';
      out.push({ beat: n.beat, dur: n.dur, key: Math.round(n.key), vel: num(n.vel, 0, 127) ? n.vel : 100 });
    }
    parts[name] = out;
  }
  const notes = parts.tabbass;
  const locs = Array.isArray(s.locators) ? s.locators : [];
  if (locs.length > 2000) return 'too many locators';
  const locators: { beat: number; name: string }[] = [];
  for (const l of locs) {
    if (!obj(l) || !num(l.beat, 0, 1e5) || !str(l.name, 200)) return 'bad locator';
    locators.push({ beat: l.beat, name: l.name });
  }
  const overrides: Record<number, NoteOverride> = {};
  if (raw.overrides !== undefined) {
    if (!obj(raw.overrides)) return 'bad overrides';
    for (const [k, v] of Object.entries(raw.overrides)) {
      const i = Number(k);
      if (!Number.isInteger(i) || i < 0 || i >= notes.length || !obj(v)) continue;
      const o: NoteOverride = {};
      if (num(v.string, 0, 3) && Number.isInteger(v.string)) o.string = v.string;
      if (num(v.finger, 1, 4) && Number.isInteger(v.finger)) o.finger = v.finger;
      if (o.string !== undefined || o.finger !== undefined) overrides[i] = o;
    }
  }
  const source = str(raw.source, 200) ? raw.source : 'workshop';
  const song: AlsSong = {
    source: str(s.source, 200) ? s.source : source, tempo: s.tempo, locators, tracks: parts,
    clipStarts: Array.isArray(s.clipStarts) ? s.clipStarts.filter((c): c is number => num(c, 0, 1e5)).slice(0, 2000) : [0],
    audioFile: str(s.audioFile, 200) ? s.audioFile : '', audioStart: num(s.audioStart, -1e5, 1e5) ? s.audioStart : 0,
  };
  if (Array.isArray(s.audioClips)) {
    song.audioClips = s.audioClips.filter((c): c is { file: string; start: number } => obj(c) && str(c.file, 200) && num(c.start, -1e5, 1e5))
      .slice(0, 200).map((c) => ({ file: c.file, start: c.start }));
  }
  if (num(s.cycleBeats, 0.5, 64)) song.cycleBeats = s.cycleBeats;
  if (Array.isArray(s.barBeats) && s.barBeats.length && s.barBeats.length <= 16 && s.barBeats.every((b) => num(b, 0.5, 64))) song.barBeats = s.barBeats as number[];
  const bars = num(raw.bars, 1, 10000) ? Math.round(raw.bars) : undefined;
  return refresh({ version: 1, source, tuning: raw.tuning, overrides, song, tab: [], ...(bars ? { bars } : {}) });
}
