// Practising a track's bass tab (2026-11-20): the pure part of PracticeSection.tsx. No DOM, no Strudel:
// test/practice.test.ts.
// - practiceCode(): the track's patch turned into a practice pattern by chaining onto its last expression (as the
//   engine's .early() does): which parts play (all, without the bass, the bass alone, click only), a loop of bars
//   (.ribbon), a count-in (.late + a click), a click all along, the speed (.slow: the pitch doesn't move). The bass
//   parts are the ones tagged .color("bass") (the BL songs, the WebApp's Strudel export).
// - position(): from the scheduler's cycle back to the song's bar, for the tab's playhead.
// - Scorer ("listen"): did the note the microphone heard match the tab's, within a window around each onset?
// - Stepper ("step"): the playhead waits on each note until it's played.
import type { TabNote } from '../../../src/core/songGrid';
import { sameNote } from '../tuner/pitch';

export type Parts = 'all' | 'nobass' | 'bass' | 'click';

export interface PracticeOpts {
  /** the loop's first bar, 0-based */
  from: number;
  /** the loop's length in bars (>= 1) */
  bars: number;
  /** speed, 0.25..1.5 (1 = the track's tempo) */
  rate: number;
  /** count-in bars (0, 1, 2) */
  countIn: number;
  /** a click on every beat, all along (else only during the count-in) */
  click: boolean;
  parts: Parts;
  /** beats per bar (a cycle = a bar) */
  bpb: number;
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/** The click's steps for a bar: the beats, or eighths for an odd meter (7.5 -> 15 eighths); accent on the first. */
export function clickMini(bpb: number): string {
  const steps = Number.isInteger(bpb) ? bpb : Math.round(bpb * 2);
  return Array.from({ length: Math.max(1, Math.min(32, steps)) }, (_, i) => (i === 0 ? 'a5' : 'e5')).join(' ');
}

/**
 * The practice pattern. `code` = the patch (undefined: a click only, at `cpm` bars a minute; the tab alone).
 * Chained onto the patch's last expression, like the engine's .early(): a patch ending in a statement fails the same.
 */
export function practiceCode(code: string | undefined, o: PracticeOpts, cpm: number): string {
  const from = Math.max(0, Math.floor(o.from));
  const bars = Math.max(1, Math.floor(o.bars));
  const count = Math.max(0, Math.min(4, Math.floor(o.countIn)));
  const rate = Math.max(0.25, Math.min(1.5, o.rate));
  let base = code?.trim() ? code.replace(/;\s*$/, '') : `setcpm(${r6(cpm)})\nsilence`;
  const lines: string[] = [];
  if (o.parts === 'nobass') lines.push(`.filterValues((v) => v.color !== 'bass')`);
  else if (o.parts === 'bass') lines.push(`.filterValues((v) => v.color === 'bass')`);
  else if (o.parts === 'click') lines.push('.filterValues(() => false)');
  lines.push(`.ribbon(${from}, ${bars})`);
  if (count > 0) lines.push(`.late(${count})`, `.filterWhen((t) => t >= ${count})`);
  if (count > 0 || o.click) {
    const click = `note("${clickMini(o.bpb)}").s("sine").attack(0.001).decay(0.05).sustain(0).gain(0.5)`;
    lines.push(`.stack(${click}${o.click ? '' : `.filterWhen((t) => t < ${count})`})`);
  }
  if (rate !== 1) lines.push(`.slow(${r6(1 / rate)})`);
  base += '\n' + lines.join('\n');
  return base;
}

export interface Position {
  /** the song's bar, fractional (0 = the first bar) */
  bar: number;
  /** while counting in: the beats left (else undefined) */
  countdown?: number;
  /** the loop's pass (0 = the first time through) */
  pass: number;
}

/** Where the practice is, from the scheduler's cycle (bars at the patch's own tempo since Play). */
export function position(schedCycle: number, o: PracticeOpts): Position {
  const rate = Math.max(0.25, Math.min(1.5, o.rate));
  const p = Math.max(0, schedCycle) * rate;
  const count = Math.max(0, Math.floor(o.countIn));
  const bars = Math.max(1, Math.floor(o.bars));
  if (p < count) return { bar: o.from, countdown: Math.ceil((count - p) * o.bpb - 1e-6), pass: 0 };
  const inLoop = p - count;
  const pass = Math.floor(inLoop / bars);
  return { bar: o.from + (inLoop - pass * bars), pass };
}

/** The tab's notes inside the loop (indexes kept: TabView's marks and the scorer use them). */
export function loopNotes(tab: TabNote[], o: Pick<PracticeOpts, 'from' | 'bars' | 'bpb'>): { i: number; n: TabNote }[] {
  const a = o.from * o.bpb - 1e-6, b = (o.from + Math.max(1, o.bars)) * o.bpb - 1e-6;
  return tab.map((n, i) => ({ i, n })).filter(({ n }) => n.beat >= a && n.beat < b);
}

/** The note sounding at `beat` (or the last one before it, held) and the next one, for the "now / next" boxes. */
export function nowNext(tab: TabNote[], beat: number): { now?: { i: number; n: TabNote }; next?: { i: number; n: TabNote } } {
  let now: { i: number; n: TabNote } | undefined;
  let next: { i: number; n: TabNote } | undefined;
  for (let i = 0; i < tab.length; i++) {
    const n = tab[i];
    if (n.beat <= beat + 1e-6) { if (beat < n.beat + Math.max(n.dur, 0.25)) now = { i, n }; }
    else { next = { i, n }; break; }
  }
  return { now, next };
}

// ---------------------------------------------------------------- listen: the microphone against the tab

export type Verdict = 'hit' | 'miss';

export interface ScoreSummary {
  hits: number;
  total: number;
  /** song bars (0-based) with a miss in the last finished pass */
  missedBars: number[];
  /** per section name: hits / total, all passes */
  sections: { name: string; hits: number; total: number }[];
}

/**
 * Each loop note, each pass: a hit when the heard key matches (or an octave off) between `early` seconds before the
 * onset and `late` seconds after it (at least to a sixteenth, at most to the note's end); a miss once that window
 * has passed. The caller feeds tick() with the practice position taken `latency` seconds back (the phone's output
 * and input delays), so the windows are about what the player heard.
 */
export class Scorer {
  readonly results = new Map<string, Verdict>();
  private lastPass = -1;
  constructor(
    private readonly notes: { i: number; n: TabNote }[],
    private readonly o: Pick<PracticeOpts, 'from' | 'bars' | 'bpb'>,
    private readonly beatsPerSecond: number,
    private readonly sectionOf: (beat: number) => string,
    private readonly early = 0.08,
    private readonly late = 0.3,
  ) {}

  /** `bar` = the song's bar (fractional) the player is at, `pass` the loop's pass, `heard` the MIDI key or undefined. */
  tick(bar: number, pass: number, heard: number | undefined): void {
    this.lastPass = Math.max(this.lastPass, pass);
    const beat = bar * this.o.bpb;
    for (const { i, n } of this.notes) {
      const id = `${pass}:${i}`;
      if (this.results.has(id)) continue;
      const lateBeats = Math.max(0.25, Math.min(n.dur, this.late * this.beatsPerSecond));
      const startBeat = n.beat - this.early * this.beatsPerSecond;
      if (beat < startBeat) continue;
      if (beat > n.beat + lateBeats) { this.results.set(id, 'miss'); continue; }
      if (heard !== undefined && sameNote(heard, n.playedKey ?? n.key)) this.results.set(id, 'hit');
    }
    // a pass that jumped (the loop wrapped): what's left of the previous pass is missed
    if (pass > 0) {
      for (const { i } of this.notes) {
        const id = `${pass - 1}:${i}`;
        if (!this.results.has(id)) this.results.set(id, 'miss');
      }
    }
  }

  summary(): ScoreSummary {
    let hits = 0, total = 0;
    const secs = new Map<string, { hits: number; total: number }>();
    const missed = new Set<number>();
    const done = this.lastPass - 1; // the last finished pass
    for (const { i, n } of this.notes) {
      for (let p = 0; p <= this.lastPass; p++) {
        const v = this.results.get(`${p}:${i}`);
        if (!v) continue;
        total++;
        const name = this.sectionOf(n.beat) || '–';
        const s = secs.get(name) ?? { hits: 0, total: 0 };
        s.total++;
        if (v === 'hit') { hits++; s.hits++; }
        secs.set(name, s);
        if (p === Math.max(0, done) && v === 'miss') missed.add(Math.floor(n.beat / this.o.bpb + 1e-6));
      }
    }
    return { hits, total, missedBars: [...missed].sort((a, b) => a - b), sections: [...secs.entries()].map(([name, s]) => ({ name, ...s })) };
  }

  /** The verdict of note `i` in its latest pass (for the tab's colours). */
  latest(i: number): Verdict | undefined {
    for (let p = this.lastPass; p >= 0; p--) {
      const v = this.results.get(`${p}:${i}`);
      if (v) return v;
    }
    return undefined;
  }
}

// ---------------------------------------------------------------- step: wait for each note

/**
 * The loop's notes one onset at a time (notes starting together count as one step, any of them accepted). A step
 * passes when the heard key matches for `hold` readings in a row; the same key twice needs a new attack (a gap or
 * another note heard in between), so a ringing note doesn't pass two steps.
 */
export class Stepper {
  readonly steps: { beat: number; notes: { i: number; n: TabNote }[] }[] = [];
  index = 0;
  private streak = 0;
  private needAttack = false;
  private lastKey: number | undefined;
  constructor(notes: { i: number; n: TabNote }[], private readonly hold = 3) {
    for (const x of notes) {
      const last = this.steps[this.steps.length - 1];
      if (last && Math.abs(last.beat - x.n.beat) < 1e-6) last.notes.push(x);
      else this.steps.push({ beat: x.n.beat, notes: [x] });
    }
  }
  get done(): boolean { return this.index >= this.steps.length; }
  get current() { return this.steps[this.index]; }
  /** One reading (MIDI key or undefined). True when the step passed. */
  feed(heard: number | undefined): boolean {
    if (this.done) return false;
    const k = heard === undefined ? undefined : Math.round(heard);
    if (k === undefined || (this.lastKey !== undefined && k !== this.lastKey)) this.needAttack = false;
    this.lastKey = k;
    if (k === undefined || this.needAttack) { this.streak = 0; return false; }
    const ok = this.current.notes.some(({ n }) => sameNote(k, n.playedKey ?? n.key));
    this.streak = ok ? this.streak + 1 : 0;
    if (this.streak < this.hold) return false;
    this.streak = 0;
    this.index++;
    this.needAttack = true;
    return true;
  }
  restart() { this.index = 0; this.streak = 0; this.needAttack = false; this.lastKey = undefined; }
}
