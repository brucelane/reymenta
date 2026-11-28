// Pure functions (no DOM) turning the notes read from an Ableton Live set
// (see alsImport.ts) into bars, a 4-string bass tablature with fingerings,
// and Strudel code. Kept DOM-free so it can be tested with plain Node.

export interface AlsNote {
  beat: number; // absolute arrangement position, in beats
  dur: number;
  vel: number;
  key: number; // MIDI key, C4 = 60 (Live displays it as C3)
}
export interface AlsClip {
  start: number; // arrangement beats
  end: number;
  loopOn: boolean;
  loopStart: number; // clip content beats
  loopEnd: number;
  startRelative: number;
  events: { time: number; dur: number; vel: number; key: number }[];
}
export interface AlsSong {
  source: string;
  tempo: number;
  locators: { beat: number; name: string }[];
  tracks: Record<string, AlsNote[]>; // "tabbass", "tabbd", ...
  clipStarts: number[];
  audioFile: string; // file name of the first audio clip ("" if none)
  audioStart: number; // its arrangement position, in beats
  /** every arrangement audio clip, so the player can use the start of the file it plays
   *  (racktrack: RackTrack.wav at 0, while the first track's clip is at 7.75; 2026-10-21) */
  audioClips?: { file: string; start: number }[];
  /** notes read from a Strudel patch (2026-11-18, the BL songs: WebApp scripts/patch-tab.ts): beats per Strudel
   *  cycle (default 4: one cycle = one 4/4 bar; 3.5 for 7/8, 7 for Kurd Engine's 4/4 + 3/4 pair) */
  cycleBeats?: number;
  /** fixed bar lengths in beats, repeated (odd meters: [3.5] for 7/8, [4, 3] for 4/4 + 3/4): replaces the 4/4
   *  grid and its anchors */
  barBeats?: number[];
  /** the set's time signatures (2026-11-25, alsImport readMeters): from each beat, bars of that many beats (3 = 3/4),
   *  until the next change; absent = 4/4 throughout */
  meters?: { beat: number; beats: number }[];
}

/** Where the played file sits in the arrangement, in beats: its own clip, else the first clip
 *  (songs imported before audioClips), else 0 (a file not in the set: a mix from the start). */
export function audioOffset(song: AlsSong, file: string): number {
  const name = file.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const clip = song.audioClips?.find((c) => c.file.toLowerCase() === name);
  if (clip) return clip.start;
  if (!song.audioClips || name === song.audioFile.toLowerCase()) return song.audioStart;
  return 0;
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** Notes a clip plays in the arrangement, looped or not. */
export function renderClip(c: AlsClip): AlsNote[] {
  const out: AlsNote[] = [];
  const length = c.end - c.start;
  const push = (p: number, e: AlsClip["events"][number]) => {
    if (p >= 0 && p < length)
      out.push({ beat: r4(c.start + p), dur: r4(Math.min(e.dur, length - p)), vel: e.vel, key: e.key });
  };
  if (c.loopOn && c.loopEnd > c.loopStart) {
    const period = c.loopEnd - c.loopStart;
    const offset = c.startRelative; // content position (from loopStart) at the clip's start
    for (let base = -offset; base < length; base += period)
      for (const e of c.events)
        if (e.time >= c.loopStart && e.time < c.loopEnd) push(base + e.time - c.loopStart, e);
  } else {
    for (const e of c.events) push(e.time - c.loopStart - c.startRelative, e);
  }
  return out;
}

// ---------------------------------------------------------------- bars

export interface Bar {
  index: number; // 0-based
  start: number; // beats
  beats: number; // 4 in 4/4, 5 for a 5/4 bar...
  sections: string[]; // locator names falling in this bar
}

export const STEPS_PER_BEAT = 4; // 16th-note grid
const q = (beat: number) => Math.round(beat * STEPS_PER_BEAT);

export function songEnd(song: AlsSong): number {
  let end = 0;
  for (const notes of Object.values(song.tracks))
    for (const n of notes) end = Math.max(end, n.beat + n.dur);
  return end;
}

/**
 * 4/4 bars, re-aligned when a clip or locator starts off the bar grid:
 * an anchor 1-2 beats into a bar lengthens the previous bar (e.g. a 5/4 bar),
 * further in it shortens the current one.
 * Not anchors (2026-10-15, namaste: strict 4/4, yet 25 bars came out 4.5/3.5): positions off the
 * beat (a pickup half a beat early), event markers when the set names its sections "#name"
 * (namaste's n/l/t markers sit mid-bar on purpose), and pickups: an anchor followed by another
 * one on the old grid's next bar line, so the grid comes straight back.
 */
export function computeBars(song: AlsSong): Bar[] {
  if (song.barBeats?.length) return fixedBars(song, song.barBeats);
  if (song.meters?.length) return meterBars(song, song.meters);
  const end = Math.ceil(songEnd(song));
  const hashSections = song.locators.some((l) => l.name.trim().startsWith("#"));
  const locatorBeats = song.locators.filter((l) => !hashSections || l.name.trim().startsWith("#")).map((l) => l.beat);
  const anchors = Array.from(
    new Set([...song.clipStarts, ...locatorBeats].map((a) => q(a) / STEPS_PER_BEAT))
  )
    .filter((a) => a > 0 && Number.isInteger(a))
    .sort((a, b) => a - b);
  const isAnchor = (beat: number) => anchors.some((a) => Math.abs(a - beat) < 0.01);
  const bars: Bar[] = [];
  let b = 0;
  while (b < end) {
    const inside = anchors.find((a) => a > b + 0.01 && a < b + 4 - 0.01 && !isAnchor(b + 4));
    if (inside !== undefined) {
      const o = inside - b;
      if (o <= 2 && bars.length) bars[bars.length - 1].beats += o;
      else bars.push({ index: bars.length, start: b, beats: o, sections: [] });
      b = inside;
      continue;
    }
    bars.push({ index: bars.length, start: b, beats: 4, sections: [] });
    b += 4;
  }
  for (const l of song.locators) {
    const bar = barAt(bars, l.beat);
    if (bar) bar.sections.push(l.name.replace(/^#/, ""));
  }
  return bars;
}

/**
 * Bars from the set's time signatures: each change starts a new bar (in Live a signature change always does), and
 * bars of its length follow until the next one; a bar cut short by a change keeps the beats it had. A change set off
 * the grid to follow a live take (carrousel: 3/4 again at 370.625) thus shifts the grid from there on.
 */
function meterBars(song: AlsSong, meters: { beat: number; beats: number }[]): Bar[] {
  const end = songEnd(song);
  const bars: Bar[] = [];
  meters.forEach((m, k) => {
    const last = k + 1 === meters.length;
    const until = last ? Math.max(end, m.beat + m.beats) : meters[k + 1].beat;
    for (let b = m.beat; b < until - 0.001; b += m.beats)
      bars.push({ index: bars.length, start: r4(b), beats: last ? m.beats : r4(Math.min(m.beats, until - b)), sections: [] });
  });
  for (const l of song.locators) {
    const bar = barAt(bars, l.beat);
    if (bar) bar.sections.push(l.name.replace(/^#/, ""));
  }
  return bars;
}

/** bars of fixed lengths (song.barBeats, repeated) up to the song's end; locators name their bars */
function fixedBars(song: AlsSong, lengths: number[]): Bar[] {
  const end = songEnd(song);
  const bars: Bar[] = [];
  for (let b = 0, i = 0; b < end - 0.001 || bars.length === 0; i++) {
    const beats = lengths[i % lengths.length];
    bars.push({ index: bars.length, start: b, beats, sections: [] });
    b += beats;
  }
  for (const l of song.locators) {
    const bar = barAt(bars, l.beat);
    if (bar) bar.sections.push(l.name.replace(/^#/, ""));
  }
  return bars;
}

/** "7/8" for 3.5 beats, "5/4" for 5 (bar labels) */
export const meterLabel = (beats: number) => (Number.isInteger(beats) ? `${beats}/4` : `${beats * 2}/8`);

export function barAt(bars: Bar[], beat: number): Bar | undefined {
  let lo = 0, hi = bars.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const bar = bars[mid];
    if (beat < bar.start) hi = mid - 1;
    else if (beat >= bar.start + bar.beats) lo = mid + 1;
    else return bar;
  }
  return undefined;
}

// ---------------------------------------------------------------- bass tab

export type TuningName = "EADG" | "DADG";
/** Open-string MIDI keys, lowest string first. */
export const TUNINGS: Record<TuningName, number[]> = {
  EADG: [28, 33, 38, 43],
  DADG: [26, 33, 38, 43],
};
export const STRING_NAMES: Record<TuningName, string[]> = {
  EADG: ["E", "A", "D", "G"],
  DADG: ["D", "A", "D", "G"],
};
const MAX_FRET = 20;
const OPEN_STRING_COST = 40; // more than any hand move: an open string only when the note has nowhere else

export interface TabNote {
  beat: number; // quantized to the 16th grid
  dur: number;
  key: number; // as written in Live
  playedKey: number; // moved by octaves when out of the bass range
  string: number; // 0 = lowest
  fret: number;
  finger: number; // 0 open, 1 index, 2 middle, 3 ring, 4 pinky
  fingerOverridden: boolean;
  stringOverridden: boolean;
}
export interface NoteOverride {
  string?: number;
  finger?: number;
}

const NOTE_NAMES = ["c", "c#", "d", "d#", "e", "f", "f#", "g", "g#", "a", "a#", "b"];
export const noteName = (key: number) => `${NOTE_NAMES[((key % 12) + 12) % 12]}${Math.floor(key / 12) - 1}`;

/**
 * Picks a string/fret for each note (cheapest path: small hand moves, low
 * positions, few string crossings), then a finger, one finger per fret from
 * the hand position. overrides are keyed by note index.
 * Open strings are avoided (2026-11-18, the user's technique: a D is played on the A string's 5th fret, not the
 * open D): an open string only when the note has no fretted place (E1 on EADG), or when an override puts it there.
 */
export function fretBass(
  notes: AlsNote[],
  tuning: TuningName,
  overrides: Record<number, NoteOverride> = {},
  /** stretch5: a hand position may cover 5 frets (3 different frets at most); off = 4 frets (the default) */
  opts: { stretch5?: boolean } = {}
): TabNote[] {
  const open = TUNINGS[tuning];
  const low = open[0], high = open[3] + MAX_FRET;
  const qn = notes.map((n) => {
    let k = n.key;
    while (k < low) k += 12;
    while (k > high) k -= 12;
    return { beat: q(n.beat) / STEPS_PER_BEAT, dur: Math.max(1, q(n.dur)) / STEPS_PER_BEAT, key: n.key, playedKey: k };
  });
  const cands = qn.map((n, i) => {
    const list: { s: number; f: number }[] = [];
    open.forEach((o, s) => {
      const f = n.playedKey - o;
      if (f >= 0 && f <= MAX_FRET && (overrides[i]?.string === undefined || overrides[i].string === s)) list.push({ s, f });
    });
    // no open string when the note can be fretted (the user's technique), unless an override asks for that string
    const fretted = overrides[i]?.string === undefined ? list.filter((c) => c.f > 0) : list;
    if (fretted.length) return fretted;
    return list.length ? list : [{ s: 0, f: Math.max(0, n.playedKey - open[0]) }];
  });

  // an open string costs more than any reasonable hand move, when the note can be fretted elsewhere
  const openCost = (i: number, c: { f: number }) => (c.f === 0 && cands[i].length > 1 ? OPEN_STRING_COST : 0);
  // Viterbi over candidates; "ref" = fret of the last fretted note on the path.
  type St = { cost: number; ref: number; prev: number };
  let layer: St[] = cands[0]?.map((c) => ({ cost: 0.15 * c.f + openCost(0, c), ref: c.f || -1, prev: -1 })) ?? [];
  const back: St[][] = [layer];
  for (let i = 1; i < cands.length; i++) {
    const next: St[] = cands[i].map((c) => {
      let best: St = { cost: Infinity, ref: -1, prev: 0 };
      cands[i - 1].forEach((p, j) => {
        const from = layer[j];
        let cost = from.cost + 0.15 * c.f + 0.3 * Math.abs(c.s - p.s) + openCost(i, c);
        if (c.f > 0 && from.ref > 0) cost += Math.abs(c.f - from.ref);
        if (cost < best.cost) best = { cost, ref: c.f > 0 ? c.f : from.ref, prev: j };
      });
      return best;
    });
    back.push(next);
    layer = next;
  }
  const pick: number[] = new Array(cands.length);
  let j = layer.reduce((bi, st, k) => (st.cost < layer[bi].cost ? k : bi), 0);
  for (let i = cands.length - 1; i >= 0; i--) {
    pick[i] = j;
    j = back[i][j].prev;
  }

  const tab: TabNote[] = qn.map((n, i) => {
    const c = cands[i][pick[i]];
    return {
      ...n, string: c.s, fret: c.f, finger: 0,
      fingerOverridden: false, stringOverridden: overrides[i]?.string !== undefined,
    };
  });

  assignFingers(tab, overrides, opts.stretch5);
  return tab;
}

/**
 * Fingers (2026-11-25, the user: "4 6 6 with middle ring pinky is unplayable, should be index for 4 and middle for
 * 6; bassists play the leftmost note of a pattern with the index"). The fretted notes are cut into runs, each the
 * longest stretch of consecutive notes within 4 frets (5 with stretch5, a track's option: at most 3 different frets,
 * index, middle, pinky); one hand position each, open strings don't break a run. In a run
 * the lowest fret takes the index, and each higher fret used takes the next finger for a step of 1 or 2 frets
 * (4 then 6 = index, middle), two fingers further for a step of 3: 4 5 6 7 = 1 2 3 4, 4 6 7 = 1 2 3, 4 7 = 1 3.
 * A finger set by hand (overrides) stays as it is.
 */
function assignFingers(tab: TabNote[], overrides: Record<number, NoteOverride>, stretch5 = false) {
  const fretted = tab.map((t, i) => i).filter((i) => tab[i].fret > 0);
  let a = 0;
  while (a < fretted.length) {
    let lo = tab[fretted[a]].fret, hi = lo, b = a + 1;
    const used = new Set([lo]);
    for (; b < fretted.length; b++) {
      const f = tab[fretted[b]].fret;
      const span = Math.max(hi, f) - Math.min(lo, f);
      // 4 frets; 5 only on tracks that ask for it (2026-11-25, the user: "usually 4 frets, 5 is carrousel only"): a
      // stretch over 5 frets holding at most 3 different frets (5 7 9 = index, middle, pinky)
      if (span > 4 || (span === 4 && (!stretch5 || new Set([...used, f]).size > 3))) break;
      used.add(f);
      lo = Math.min(lo, f);
      hi = Math.max(hi, f);
    }
    const frets = [...new Set(fretted.slice(a, b).map((i) => tab[i].fret))].sort((x, y) => x - y);
    const fingerOf = new Map<number, number>();
    if (hi - lo === 4) {
      // stretched: index on the lowest, pinky on the highest, a fret between on the middle (2 frets up) or ring
      frets.forEach((f) => fingerOf.set(f, f === lo ? 1 : f === hi ? 4 : f - lo <= 2 ? 2 : 3));
    } else
      frets.forEach((f, k) => {
        if (k === 0) return fingerOf.set(f, 1);
        const prev = fingerOf.get(frets[k - 1])!;
        fingerOf.set(f, Math.min(4, prev + (f - frets[k - 1] >= 3 ? 2 : 1)));
      });
    for (const i of fretted.slice(a, b)) {
      const forced = overrides[i]?.finger;
      if (forced && forced >= 1 && forced <= 4) {
        tab[i].finger = forced;
        tab[i].fingerOverridden = true;
      } else tab[i].finger = fingerOf.get(tab[i].fret)!;
    }
    a = b;
  }
}

/**
 * The generated bass tablature as saved with a track (<id>.tab.json): the notes read from
 * the Ableton set (song: enough to rebuild the tab and the Strudel code without the .als),
 * the finger/string edits, the tuning, and the computed frets/fingers for other readers.
 */
export interface TabData {
  version: 1;
  source: string; // .als file name
  tuning: TuningName;
  overrides: Record<number, NoteOverride>;
  song: AlsSong;
  tab: { beat: number; dur: number; key: number; string: number; fret: number; finger: number }[];
}

// ---------------------------------------------------------------- strudel

/** Strudel sound per drum track name ("tabtoms": several sounds, see tomSound). */
export const DRUM_TRACKS: Record<string, string> = {
  tabbd: "bd", tabsn: "sd", tabchh: "hh", tabohh: "oh", tabcrash: "cr", tabride: "rd", tabtoms: "mt",
};
/** "tabtoms" (2026-10-19): the toms by pitch within the track, whatever keys the notes use:
 * the lowest note is "lt", the highest "ht", any other "mt" (one pitch only: "mt"). */
const tomSound = (notes: AlsNote[]): ((n: AlsNote) => string) => {
  const keys = Array.from(new Set(notes.map((n) => n.key))).sort((a, b) => a - b);
  const lo = keys[0], hi = keys[keys.length - 1];
  return (n) => (lo === hi ? "mt" : n.key === lo ? "lt" : n.key === hi ? "ht" : "mt");
};
/** General MIDI drum keys, for a combined "tabdrums" track. */
const GM_DRUMS: Record<number, string> = {
  35: "bd", 36: "bd", 37: "rim", 38: "sd", 39: "cp", 40: "sd", 41: "lt", 42: "hh", 43: "lt", 44: "hh",
  45: "mt", 46: "oh", 47: "mt", 48: "ht", 49: "cr", 50: "ht", 51: "rd", 52: "cr", 53: "rd", 55: "cr", 57: "cr", 59: "rd",
};

interface Ev { step: number; len: number; token: string }

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const fmt = (x: number) => String(Math.round(x * 1000) / 1000);

/**
 * One arrange() for one part: bars are grouped into phrases (1, 2, 4, 8...
 * bars) and consecutive repeats of a phrase become one [cycles, "..."] entry.
 * One cycle = one 4/4 bar.
 */
function arrangePart(bars: Bar[], evs: Ev[], drums: boolean): string {
  const barStep = (b: Bar) => q(b.start);
  const barEnd = (b: Bar) => q(b.start + b.beats);
  // signature of each bar: events starting in it + any note still held at its start
  const sigs = bars.map((b) => {
    const s0 = barStep(b), s1 = barEnd(b);
    const held = drums ? undefined : evs.find((e) => e.step < s0 && e.step + e.len > s0);
    const inBar = evs
      .filter((e) => e.step >= s0 && e.step < s1)
      .map((e) => (drums ? `${e.step - s0}:${e.token}` : `${e.step - s0}:${e.token}:${e.len}`));
    return `${b.beats}|${held ? `${held.token}:${held.step + held.len - s0}` : ""}|${inBar.join(",")}`;
  });

  // mini-notation for the events of one span (steps relative to its start)
  const render = (list: Ev[], total: number): string => {
    if (!list.length) return "~";
    const onsets = Array.from(new Set(list.map((e) => e.step))).sort((a, b) => a - b);
    const at = (s: number) => list.filter((e) => e.step === s);
    const tok = (es: Ev[]) => {
      const names = Array.from(new Set(es.map((e) => e.token)));
      return names.length > 1 ? `[${names.join(",")}]` : names[0];
    };
    if (drums) {
      const g = onsets.reduce((a, s) => gcd(a, s), total);
      const slots: string[] = [];
      for (let s = 0; s < total; s += g) slots.push(onsets.includes(s) ? tok(at(s)) : "~");
      return slots.join(" ");
    }
    const items: { t: string; w: number }[] = [];
    if (onsets[0] > 0) items.push({ t: "~", w: onsets[0] });
    onsets.forEach((s, k) => {
      const nextOnset = k + 1 < onsets.length ? onsets[k + 1] : total;
      const es = at(s);
      const len = Math.min(Math.max(...es.map((e) => e.len)), nextOnset - s);
      items.push({ t: tok(es), w: len });
      if (s + len < nextOnset) items.push({ t: "~", w: nextOnset - s - len });
    });
    const g = items.reduce((a, it) => gcd(a, it.w), 0) || 1;
    return items.map((it) => (it.w / g === 1 ? it.t : `${it.t}@${it.w / g}`)).join(" ");
  };
  // events of [s0, s1), clipped to it; a note held from before is struck again at s0
  const slice = (s0: number, s1: number): Ev[] => {
    const list: Ev[] = [];
    for (const e of evs) {
      if (e.step >= s0 && e.step < s1) list.push({ ...e, step: e.step - s0 });
      else if (!drums && e.step < s0 && e.step + e.len > s0) list.push({ ...e, step: 0, len: e.step + e.len - s0 });
    }
    return list;
  };

  const phrase = (from: number, m: number): string => {
    const span = bars.slice(from, from + m);
    const s0 = barStep(span[0]), s1 = barEnd(span[m - 1]);
    // several 4/4 bars with no note ringing over a bar line: one bar per cycle, "<bar1 bar2 ...>"
    const crosses = !drums && evs.some((e) => e.step >= s0 && e.step < s1 && span.some((b) => e.step < barStep(b) && e.step + e.len > barStep(b)));
    if (m > 1 && !crosses && span.every((b) => b.beats === 4)) {
      const parts = span.map((b) => render(slice(barStep(b), barEnd(b)), barEnd(b) - barStep(b)));
      return `<${parts.map((x) => (x.includes(" ") ? `[${x}]` : x)).join(" ")}>`;
    }
    const body = render(slice(s0, s1), s1 - s0);
    const cycles = (s1 - s0) / (4 * STEPS_PER_BEAT);
    return cycles === 1 || body === "~" ? body : `[${body}]/${fmt(cycles)}`;
  };

  const entries: { cycles: number; p: string }[] = [];
  let i = 0;
  while (i < bars.length) {
    let best = { m: 1, r: 1 };
    for (const m of [1, 2, 3, 4, 6, 8, 12, 16]) {
      if (i + m > bars.length) break;
      let r = 1;
      while (i + (r + 1) * m <= bars.length) {
        let same = true;
        for (let k = 0; k < m && same; k++) same = sigs[i + k] === sigs[i + r * m + k];
        if (!same) break;
        r++;
      }
      if ((m === 1 || r >= 2) && m * r > best.m * best.r) best = { m, r };
    }
    // A single bar whose note rings into the next one: extend the phrase to the
    // end of that note, so it isn't struck again on every bar.
    if (!drums && best.m === 1 && best.r === 1) {
      const heldAt = (k: number) => evs.some((e) => e.step < barStep(bars[k]) && e.step + e.len > barStep(bars[k]));
      while (i + best.m < bars.length && heldAt(i + best.m)) best.m++;
    }
    const beats = bars.slice(i, i + best.m).reduce((a, b) => a + b.beats, 0);
    const p = phrase(i, best.m);
    const cycles = (beats / 4) * best.r;
    const prev = entries[entries.length - 1];
    if (p === "~" && prev?.p === "~") prev.cycles += cycles; // merge silences
    else entries.push({ cycles, p });
    i += best.m * best.r;
  }
  return `arrange(\n${entries.map((e) => `  [${fmt(e.cycles)}, "${e.p}"]`).join(",\n")}\n)`;
}

export interface StrudelOptions {
  bass: boolean;
  drums: boolean;
  synth: boolean;
  gtr: boolean;
  organ: boolean;
  bassSound: string;
  drumBank: string;
  synthSound: string;
  gtrSound: string;
  organSound: string;
  /** Strudel distort value ("amount:postgain") for the bass and the guitar; "" = clean */
  bassDistort: string;
  gtrDistort: string;
}
export const DEFAULT_STRUDEL: StrudelOptions = {
  bass: true, drums: true, synth: true, gtr: true, organ: true,
  bassSound: "reese", drumBank: "RolandTR909", synthSound: "sawtooth",
  gtrSound: "gm_overdriven_guitar", organSound: "gm_drawbar_organ",
  bassDistort: "2:.5", gtrDistort: "3:.4",
};

// sound and bank names go inside "..." in the generated code: keep them to name characters,
// so a pasted or stored setting can't end the string and add code
const soundName = (v: string) => v.replace(/[^A-Za-z0-9_:.\-]/g, "");
// Electronic bass presets (2026-11-19, the user: no GM basses): the sounds he liked, as one name in the options.
// "reese" = Hex Bolt's, "fm" = Cold Ferry's; tagged .color("bass") so the tab tool and the Ableton export find them.
export const BASS_PRESETS: Record<string, string> = {
  reese: `.s("supersaw").detune(.35).unison(3).spread(.2).lpf(700).lpq(3).color("bass")`,
  fm: `.s("sine").fm(2.5).fmh(1).fmdecay(.25).fmsustain(.2).color("bass")`,
};
const voice = (sound: string) => BASS_PRESETS[sound] ?? `.sound("${soundName(sound)}")`;
const distort = (v: string) => (v.trim() ? `.distort("${v.trim().replace(/["\\]/g, "")}")` : "");

/** A song read back from a hand-written patch (patch-tab.mjs: source "<x>.strudel.js") only holds the bass:
 * regenerating from it would drop every other part (2026-11-25: "other instruments mute"). */
export const isPatchSong = (song: { source?: string } | null | undefined) => !!song?.source && /\.strudel\.js$/i.test(song.source);

/** Change the bass sound / distort of a hand-written patch in place, on the line tagged .color("bass"):
 * from its first .s("…")/.sound("…") to .color("bass") becomes the new voice; .distort("…") on that line is
 * replaced (or added after .color("bass")), removed when empty. undefined: no such line. */
export function retuneBassInCode(code: string, change: { bassSound?: string; bassDistort?: string }): string | undefined {
  const lines = code.split("\n");
  const i = lines.findIndex((l) => l.includes('.color("bass")') && !l.trimStart().startsWith("//"));
  if (i < 0) return undefined;
  let line = lines[i];
  if (change.bassSound !== undefined) {
    const re = /\.(?:s|sound)\("[^"]*"\)[^\n]*?\.color\("bass"\)/;
    if (!re.test(line)) return undefined;
    const v = voice(change.bassSound);
    line = line.replace(re, v.endsWith('.color("bass")') ? v : `${v}.color("bass")`);
  }
  if (change.bassDistort !== undefined) {
    const d = distort(change.bassDistort);
    if (/\.distort\("[^"]*"\)/.test(line)) line = line.replace(/\.distort\("[^"]*"\)/, d);
    else if (d) line = line.replace('.color("bass")', `.color("bass")${d}`);
  }
  lines[i] = line;
  return lines.join("\n");
}

const toEvs = (notes: AlsNote[], token: (n: AlsNote) => string): Ev[] =>
  notes.map((n) => ({ step: q(n.beat), len: Math.max(1, q(n.dur)), token: token(n) }));

export function buildStrudel(song: AlsSong, bars: Bar[], options: StrudelOptions): string {
  // settings saved before a field existed lack it: take the default
  const o = { ...DEFAULT_STRUDEL, ...options };
  const parts: { name: string; code: string }[] = [];
  const melodic = (name: string, notes: AlsNote[] | undefined, sound: string, fx: string) => {
    if (notes?.length)
      parts.push({ name, code: `note(${arrangePart(bars, toEvs(notes, (n) => noteName(n.key)), false)})${voice(sound)}${fx}` });
  };
  if (o.bass) melodic("bass", song.tracks.tabbass, o.bassSound, distort(o.bassDistort));

  if (o.drums) {
    const drumEvs: Record<string, Ev[]> = {};
    for (const [track, sound] of Object.entries(DRUM_TRACKS)) {
      const notes = song.tracks[track];
      if (!notes?.length) continue;
      if (track === "tabtoms") {
        const pick = tomSound(notes);
        for (const n of notes) (drumEvs[pick(n)] ??= []).push(...toEvs([n], pick));
      } else (drumEvs[sound] ??= []).push(...toEvs(notes, () => sound));
    }
    for (const n of song.tracks.tabdrums ?? []) {
      const sound = GM_DRUMS[n.key] ?? "perc";
      (drumEvs[sound] ??= []).push(...toEvs([n], () => sound));
    }
    for (const [sound, evs] of Object.entries(drumEvs)) {
      evs.sort((a, b) => a.step - b.step);
      parts.push({ name: sound, code: `s(${arrangePart(bars, evs, true)}).bank("${soundName(o.drumBank)}")` });
    }
  }
  if (o.synth) melodic("synth", song.tracks.tabsynth, o.synthSound, ".lpf(1500)");
  if (o.gtr) melodic("gtr", song.tracks.tabgtr, o.gtrSound, distort(o.gtrDistort));
  if (o.organ) melodic("organ", song.tracks.taborgan, o.organSound, "");

  const header = [
    // one comment line: a file name with a line break must not end the comment and add code
    `// ${song.source.replace(/[\r\n\u2028\u2029]+/g, " ")}`,
    `// generated from the Ableton Live set: 1 cycle = 1 bar of 4/4 at ${fmt(song.tempo)} bpm`,
    `setcpm(${fmt(song.tempo)}/4)`,
  ];
  if (!parts.length) return [...header, "silence"].join("\n");
  return [
    header.join("\n"),
    ...parts.map((p) => `const ${p.name} = ${p.code}`),
    `stack(${parts.map((p) => p.name).join(", ")})`,
  ].join("\n\n");
}

// ------------------------------------------------- a track's own samples (2026-10-19)

/** assets/strudel/samples/<folder>/samples.meta.json, written by TSWebsocketServer's
 * services/alsSamples.ts from the folder's Ableton set (studies/strudel-samples.md). */
export interface SamplesMeta {
  folder: string;
  bank: string;
  source: string;
  tempo: number;
  locators: { beat: number; name: string }[];
  sounds: { name: string; kind: "oneshot" | "loop" | "pitched"; variants: { key: string; beats: number; seconds: number }[] }[];
  events: { sound: string; key: string; beat: number; dur: number }[];
  warnings?: string[];
}

/**
 * The starting patch for a track's own samples: trackSamples() (lib/strudelEngine.ts) loads and
 * preloads them, then one part per sound replays its clips where they sit in the arrangement:
 * one-shots s("kick:1").bank(...), loops .fit() (stretched to their length: they follow the
 * tempo), pitched sounds note(...).s(...). 1 cycle = 1 bar of 4/4, sections from "#" locators.
 */
export function buildSamplesStrudel(meta: SamplesMeta): string {
  const song: AlsSong = {
    source: meta.source, tempo: meta.tempo, locators: meta.locators, tracks: {},
    clipStarts: meta.events.map((e) => e.beat), audioFile: "", audioStart: 0,
  };
  for (const e of meta.events) (song.tracks[`smp_${e.sound}`] ??= []).push({ beat: e.beat, dur: e.dur, vel: 100, key: 0 });
  const bars = computeBars(song);
  const bank = soundName(meta.bank);
  // a sound name is [a-z0-9]+ (alsSamples smpTrack); a const can't start with a digit
  const ident = (s: string) => (/^[a-z_]/i.test(s) ? s : `s${s}`).replace(/[^A-Za-z0-9_]/g, "_");
  const parts: { name: string; code: string }[] = [];
  const listed: string[] = [];
  for (const s of meta.sounds) {
    const name = soundName(s.name);
    const evs: Ev[] = meta.events
      .filter((e) => e.sound === s.name)
      .map((e) => ({ step: q(e.beat), len: Math.max(1, q(e.dur)), token: s.kind === "pitched" ? soundName(e.key) : `${name}:${soundName(e.key)}` }))
      .sort((a, b) => a.step - b.step);
    const keys = s.variants.map((v) => (s.kind === "loop" ? `${v.key} (${fmt(v.beats / 4)} bars)` : v.key)).join(" ");
    listed.push(`//   ${bank}_${name} (${s.kind}): ${keys}`);
    if (!evs.length) continue;
    const pat = arrangePart(bars, evs, s.kind === "oneshot");
    const code =
      s.kind === "pitched" ? `note(${pat}).s("${name}").bank("${bank}")`
      : s.kind === "loop" ? `s(${pat}).bank("${bank}").fit()`
      : `s(${pat}).bank("${bank}")`;
    parts.push({ name: ident(name), code });
  }
  // locator names go into comment lines: one line each, or a name could end the comment and add code
  const breaks = new RegExp(`[\\r\\n${String.fromCharCode(0x2028, 0x2029)}]+`, "g");
  const sections = bars.filter((b) => b.sections.length).map((b) => `//   bar ${b.index + 1}: ${b.sections.join(", ").replace(breaks, " ")}`);
  const header = [
    `// ${meta.source.replace(/[\r\n\u2028\u2029]+/g, " ")}: the track's own samples (assets/strudel/samples/${meta.folder.replace(/[\r\n\u2028\u2029]+/g, " ")})`,
    `// 1 cycle = 1 bar of 4/4 at ${fmt(meta.tempo)} bpm. Sounds (s("<name>:<n>").bank("${bank}")):`,
    ...listed,
    ...(sections.length ? ["// sections:", ...sections] : []),
    `await trackSamples(${JSON.stringify(meta.folder)})`,
    `setcpm(${fmt(meta.tempo)}/4)`,
  ];
  if (!parts.length) return [...header, `// no clip in the arrangement: play them by name, e.g. s("${soundName(meta.sounds[0]?.name ?? "kick")}:0").bank("${bank}")`, "silence"].join("\n");
  return [
    header.join("\n"),
    ...parts.map((p) => `const ${p.name} = ${p.code}`),
    `stack(${parts.map((p) => p.name).join(", ")})`,
  ].join("\n\n");
}

/** strudel.cc URL hash for a piece of code (same encoding as Strudel's share links). */
export function strudelHash(code: string): string {
  const bytes = new TextEncoder().encode(code);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return "#" + encodeURIComponent(btoa(bin));
}
