// A Workshop track as notes for other programs (studies/reymenta-workshop.md step 6): the parts written to a MIDI file
// (here) and to an Ableton set (alsWrite.ts). Pure functions, no DOM, no Strudel: the patch's haps are queried by the
// engine (strudelEngine.ts queryHaps) and handed here.
// Parts, in this order:
// - "tabbass": the bass tab (song.tracks.tabbass), as the WebApp's Track pane names it (an .als re-imports it);
// - "tabdrums": the drum tab, General MIDI keys, MIDI channel 10 (the WebApp's name for a combined drum track);
// - one part per sound of the patch ("gm_electric_bass_pick", "RolandTR909 bd"...), named "<sound> notes" like the
//   WebApp's Export to Ableton; drum sounds get GM keys and channel 10.
// 1 Strudel cycle = 1 bar of the track's beats per bar (the Workshop's convention), so beat = cycle x beatsPerBar.
// Why not src/core/midiFile.ts's songToMidi: it writes 4/4 only and picks the drum channel from the track's name (one
// "tabdrums" at most), so a patch's drum sounds would land on melodic channels. Same format otherwise (type 1,
// MIDI_PPQ ticks per beat, a conductor track with the tempo and the locators as markers, note-offs before note-ons).
import { MIDI_PPQ } from '../../../src/core/midiFile';
import { patchSections } from '../../../src/core/strudelLength';
import type { DrumTab, DrumVoice } from './drums';
import type { WTab } from './tabEdit';

export interface ExportNote { beat: number; dur: number; key: number; vel: number }
export interface ExportPart {
  /** the track's name in the MIDI file and in Live */
  name: string;
  notes: ExportNote[];
  /** drums: MIDI channel 10 */
  drum: boolean;
}
export interface ExportSong {
  title: string;
  bpm: number;
  beatsPerBar: number;
  /** the song's length in beats (the parts' end, rounded up to a bar) */
  beats: number;
  locators: { beat: number; name: string }[];
  parts: ExportPart[];
  /** (2026-11-20) Session view: one scene per section, each part's notes of that section as a looping clip */
  scenes?: { name: string; start: number; end: number }[];
  /** (2026-11-20) the arrangement loop (beats), switched on */
  loop?: { start: number; length: number };
  /** (2026-11-20) parts muted in Live (their track's speaker off) */
  muted?: string[];
}
export interface ExportHap { begin: number; end?: number; value: Record<string, unknown> }

/** A patch's notes are capped (a runaway pattern over 1024 bars could give millions). */
export const MAX_EXPORT_NOTES = 200_000;

/** General MIDI drum keys for Strudel's drum names (the WebApp's strudelExport.ts DRUM_KEYS). */
export const GM_DRUM_KEYS: Record<string, number> = {
  bd: 36, rim: 37, sd: 38, cp: 39, lt: 41, ch: 42, hh: 42, mt: 45, oh: 46, ht: 48, cr: 49, rd: 51, cb: 56, sh: 70, tb: 54,
  perc: 60, misc: 60, fx: 60,
};

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');
const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** "c#3", "Eb2", "a" (octave 3 by default, as Strudel) -> MIDI key; undefined when it isn't a note name. */
export function noteNameToMidi(name: string): number | undefined {
  const m = /^([a-gA-G])([#bsf]*)(-?\d+)?$/.exec(name.trim());
  if (!m) return undefined;
  const chroma = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase() as 'c'];
  const acc = [...m[2]].reduce((s, c) => s + (c === '#' || c === 's' ? 1 : -1), 0);
  const octave = m[3] === undefined ? 3 : Number(m[3]);
  return (octave + 1) * 12 + chroma + acc;
}

/** The sound a hap plays, without the "<bank>_" superdough adds once it played it. */
const soundOf = (v: Record<string, unknown>) => {
  const bank = str(v.bank).toLowerCase();
  const s = str(v.s).toLowerCase();
  return bank && s.startsWith(`${bank}_`) ? s.slice(bank.length + 1) : s;
};

/** A drum hit: no pitch, and a bank or a known drum name. */
export const isDrumValue = (v: Record<string, unknown>) =>
  v.note === undefined && v.freq === undefined && (!!str(v.bank) || GM_DRUM_KEYS[soundOf(v)] !== undefined);

/** The part a hap belongs to: its sound with its bank ("RolandTR909 bd"); a note without sound = Strudel's triangle. */
export function hapPart(v: Record<string, unknown>): string {
  const s = str(v.s) ? soundOf(v) || str(v.s) : v.note !== undefined || v.freq !== undefined ? 'triangle' : 'sound';
  const bank = str(v.bank);
  return bank ? `${bank} ${s}` : s;
}

/** MIDI key of a hap: note (number or name; n as a scale degree isn't resolved), freq, else the drum's GM key. */
export function hapKey(v: Record<string, unknown>): number {
  let key: number | undefined;
  if (typeof v.note === 'number') key = v.note;
  else if (typeof v.note === 'string') key = noteNameToMidi(v.note);
  else if (typeof v.freq === 'number' && v.freq > 0) key = 69 + 12 * Math.log2(v.freq / 440);
  key ??= GM_DRUM_KEYS[soundOf(v)] ?? 60;
  return Math.max(0, Math.min(127, Math.round(key)));
}

/** Velocity 1-127 from Strudel's velocity and gain (both 1 by default: 100). */
export function hapVelocity(v: Record<string, unknown>): number {
  const vel = typeof v.velocity === 'number' ? v.velocity : 1;
  const gain = typeof v.gain === 'number' ? Math.min(v.gain, 1.27) : 1;
  return Math.max(1, Math.min(127, Math.round(100 * vel * gain)));
}

/** The patch's haps as parts, one per sound (first appearance order). Onsets only; begin/end in cycles. */
export function partsFromHaps(haps: ExportHap[], beatsPerBar: number): ExportPart[] {
  const parts = new Map<string, ExportPart>();
  let count = 0;
  for (const h of haps) {
    if (!Number.isFinite(h.begin) || h.begin < 0 || count >= MAX_EXPORT_NOTES) continue;
    const v = h.value ?? {};
    const name = `${hapPart(v)} notes`;
    let p = parts.get(name);
    if (!p) { p = { name, notes: [], drum: isDrumValue(v) }; parts.set(name, p); }
    const end = typeof h.end === 'number' && h.end > h.begin ? h.end : h.begin + 0.25 / beatsPerBar;
    p.notes.push({ beat: r6(h.begin * beatsPerBar), dur: r6(Math.max(1 / 64, (end - h.begin) * beatsPerBar)), key: hapKey(v), vel: hapVelocity(v) });
    count++;
  }
  for (const p of parts.values()) p.notes.sort((a, b) => a.beat - b.beat || a.key - b.key);
  return [...parts.values()];
}

/** The bass tab's notes (as stored: song.tracks.tabbass). */
export function bassPart(tab: WTab): ExportPart {
  const notes = (tab.song.tracks.tabbass ?? []).map((n) => ({ beat: n.beat, dur: n.dur, key: Math.round(n.key), vel: Math.round(n.vel || 100) }));
  return { name: 'tabbass', notes, drum: false };
}

const DRUM_TAB_KEYS: Record<DrumVoice, number> = { bd: 36, sd: 38, hh: 42, oh: 46, rd: 51, cr: 49, lt: 41, mt: 45, ht: 48, rim: 37, cp: 39 };

/** The drum tab's hits: a 16th each, GM keys, bars one after the other (a bar = steps / 4 beats). */
export function drumTabPart(d: DrumTab): ExportPart {
  const notes: ExportNote[] = [];
  let start = 0;
  for (const bar of d.bars) {
    const stepBeats = 0.25;
    for (const [voice, hits] of Object.entries(bar.hits) as [DrumVoice, string][]) {
      for (let i = 0; i < Math.min(hits.length, bar.steps); i++) {
        if (hits[i] === 'x') notes.push({ beat: r6(start + i * stepBeats), dur: stepBeats, key: DRUM_TAB_KEYS[voice], vel: 100 });
      }
    }
    start += bar.steps * stepBeats;
  }
  notes.sort((a, b) => a.beat - b.beat || a.key - b.key);
  return { name: 'tabdrums', notes, drum: true };
}

/**
 * Everything of a track as one song: bass tab, drum tab, the patch's parts (those given), the tempo, and the
 * locators: the tab's "#" sections, else the patch's "// Sections" header.
 */
export function buildExportSong(o: {
  title: string; bpm?: number; beatsPerBar?: number; tab?: WTab; drums?: DrumTab; patch?: string; haps?: ExportHap[];
}): ExportSong {
  const bpb = o.beatsPerBar && o.beatsPerBar > 0 ? o.beatsPerBar : 4;
  const bpm = o.bpm && o.bpm > 0 ? o.bpm : o.tab?.song.tempo || 120;
  const parts: ExportPart[] = [];
  if (o.tab && (o.tab.song.tracks.tabbass ?? []).length) parts.push(bassPart(o.tab));
  if (o.drums) { const d = drumTabPart(o.drums); if (d.notes.length) parts.push(d); }
  if (o.haps?.length) parts.push(...partsFromHaps(o.haps, bpb));
  let locators = (o.tab?.song.locators ?? []).map((l) => ({ beat: l.beat, name: l.name }));
  if (!locators.length && o.patch) locators = patchSections(o.patch).map((s) => ({ beat: (s.bar - 1) * bpb, name: `#${s.name}` }));
  const last = Math.max(0, ...parts.flatMap((p) => p.notes.map((n) => n.beat + n.dur)), ...locators.map((l) => l.beat));
  const beats = Math.max(bpb, Math.ceil(last / bpb - 1e-9) * bpb);
  return { title: o.title, bpm, beatsPerBar: bpb, beats, locators: locators.sort((a, b) => a.beat - b.beat), parts };
}

// ---------------------------------------------------------------- MIDI file

const vlq = (v: number): number[] => {
  let n = Math.max(0, Math.round(v));
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
};
const u32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const text = (s: string) => Array.from(new TextEncoder().encode(s));
interface Ev { tick: number; order: number; bytes: number[] }

function chunk(events: Ev[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let last = 0;
  for (const e of events) {
    body.push(...vlq(e.tick - last));
    for (const b of e.bytes) body.push(b);
    last = e.tick;
  }
  body.push(0, 0xff, 0x2f, 0); // end of track
  return [0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body]; // "MTrk"
}
const meta = (tick: number, type: number, data: number[]): Ev => ({ tick, order: 0, bytes: [0xff, type, ...vlq(data.length), ...data] });

/** The time signature of a bar of `beats` quarter notes: 4 -> 4/4, 3.5 -> 7/8, else 4/4. */
export function timeSignature(beats: number): [number, number] {
  if (Number.isInteger(beats) && beats >= 1 && beats <= 32) return [beats, 4];
  if (Number.isInteger(beats * 2) && beats * 2 <= 64) return [beats * 2, 8];
  return [4, 4];
}

/** MIDI channels (0-based): drums on 9, the others 0, 1, 2... skipping 9 (wrapping after 16). */
export function partChannels(parts: ExportPart[]): number[] {
  let next = 0;
  return parts.map((p) => {
    if (p.drum) return 9;
    if (next % 16 === 9) next++;
    return next++ % 16;
  });
}

/** A type 1 Standard MIDI File: the conductor (title, tempo, time signature, locators as markers), a track per part. */
export function songToMidiFile(song: ExportSong): Uint8Array {
  const usPerBeat = Math.round(60_000_000 / (song.bpm || 120));
  const [num, den] = timeSignature(song.beatsPerBar);
  const conductor = chunk([
    meta(0, 0x03, text(song.title)),
    meta(0, 0x51, [(usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff]),
    meta(0, 0x58, [num, Math.log2(den), 24, 8]),
    ...song.locators.map((l) => meta(Math.round(l.beat * MIDI_PPQ), 0x06, text(l.name))),
  ]);
  const chans = partChannels(song.parts);
  const tracks = song.parts.map((p, i) => {
    const ch = chans[i] & 0x0f;
    const events: Ev[] = [meta(0, 0x03, text(p.name))];
    for (const n of p.notes) {
      const on = Math.round(n.beat * MIDI_PPQ);
      const off = Math.max(on + 1, Math.round((n.beat + n.dur) * MIDI_PPQ));
      const key = Math.min(127, Math.max(0, Math.round(n.key)));
      const vel = Math.min(127, Math.max(1, Math.round(n.vel)));
      events.push({ tick: on, order: 2, bytes: [0x90 | ch, key, vel] });
      events.push({ tick: off, order: 1, bytes: [0x80 | ch, key, 0] });
    }
    return chunk(events);
  });
  const header = [0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, 1, (tracks.length + 1) >> 8, (tracks.length + 1) & 0xff, (MIDI_PPQ >> 8) & 0xff, MIDI_PPQ & 0xff];
  const all = [header, conductor, ...tracks];
  const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let o = 0;
  for (const a of all) { out.set(a, o); o += a.length; }
  return out;
}

/** A file name from a folder ("hexbolt" -> "hexbolt.mid"). */
export const safeName = (s: string) => s.replace(/[^\w .()+-]+/g, '_').replace(/^\.+/, '').trim() || 'track';

// ---------------------------------------------------------------- Ableton extras (2026-11-20)

/** GM's hi / low wood block: the click's accent and its other beats (Live's Drum Racks put a sound there or not). */
export const CLICK_KEYS = { accent: 76, beat: 77 };

/** A click track: every beat over `beats` (eighths for an odd meter like 7/8), the bar's first one accented. */
export function clickPart(beats: number, beatsPerBar: number, from = 0): ExportPart {
  const step = Number.isInteger(beatsPerBar) ? 1 : 0.5;
  const notes: ExportNote[] = [];
  for (let bar = from; bar < beats - 1e-9; bar += beatsPerBar) {
    for (let b = 0; b < beatsPerBar - 1e-9 && bar + b < beats - 1e-9; b += step) {
      notes.push({ beat: r6(bar + b), dur: 0.25, key: b === 0 ? CLICK_KEYS.accent : CLICK_KEYS.beat, vel: b === 0 ? 120 : 90 });
    }
  }
  return { name: 'click', notes, drum: true };
}

/** Everything moved `bars` bars later (a count-in at the start), the click (if any) filling the new bars too. */
export function withCountIn(song: ExportSong, bars: number): ExportSong {
  const shift = Math.max(0, Math.round(bars)) * song.beatsPerBar;
  if (!shift) return song;
  const parts = song.parts.map((p) => (p.name === 'click'
    ? clickPart(song.beats + shift, song.beatsPerBar)
    : { ...p, notes: p.notes.map((n) => ({ ...n, beat: r6(n.beat + shift) })) }));
  return {
    ...song, beats: song.beats + shift, parts,
    locators: [{ beat: 0, name: '#count-in' }, ...song.locators.map((l) => ({ ...l, beat: l.beat + shift }))],
    scenes: song.scenes?.map((s) => ({ ...s, start: s.start + shift, end: s.end + shift })),
    loop: song.loop && { ...song.loop, start: song.loop.start + shift },
  };
}

/** One scene per section (the locators; before the first one: "start"), whole song when there's none. */
export function sectionScenes(song: ExportSong): { name: string; start: number; end: number }[] {
  const locs = song.locators.filter((l) => l.beat >= 0 && l.beat < song.beats).sort((a, b) => a.beat - b.beat);
  const marks = locs.length && locs[0].beat > 0 ? [{ beat: 0, name: 'start' }, ...locs] : locs;
  if (!marks.length) return [{ name: song.title || 'song', start: 0, end: song.beats }];
  return marks
    .map((l, i) => ({ name: l.name.replace(/^#/, ''), start: l.beat, end: marks[i + 1]?.beat ?? song.beats }))
    .filter((s) => s.end - s.start > 1e-6);
}

/**
 * A practice set: the tempo at `rate`, the arrangement loop on bars [fromBar, fromBar + bars), the bass tab's track
 * muted (to play it yourself over the rest), a click track.
 */
export function practiceSong(song: ExportSong, o: { fromBar: number; bars: number; rate: number; muteBass: boolean; click: boolean }): ExportSong {
  const parts = o.click && !song.parts.some((p) => p.name === 'click') ? [...song.parts, clickPart(song.beats, song.beatsPerBar)] : song.parts;
  const start = Math.max(0, Math.floor(o.fromBar)) * song.beatsPerBar;
  const length = Math.max(1, Math.floor(o.bars)) * song.beatsPerBar;
  const muted = o.muteBass ? parts.filter((p) => p.name === 'tabbass' || /bass/i.test(p.name)).map((p) => p.name) : [];
  return { ...song, title: `${song.title} (practice)`, bpm: r6(song.bpm * Math.max(0.25, Math.min(1.5, o.rate))), parts, loop: { start, length }, muted };
}
