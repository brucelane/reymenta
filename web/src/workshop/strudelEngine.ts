// Strudel in the Workshop (studies/reymenta-workshop.md step 4): a slim copy of the WebApp's lib/strudelEngine.ts,
// without its song clock, Cinder, server MIDI or local sound cache. Loaded only when a Strudel or drum section opens
// (StrudelSection/DrumSection are lazy), so the Show page and the Workshop's first screen don't carry it.
// - @strudel/web/web.mjs (the package's source entry), not "@strudel/web": that one is a prebuilt bundle with its
//   own copy of the audio engine, and the GM soundfonts (@strudel/soundfonts, registered into the shared superdough)
//   were "not found" by it (the WebApp's finding).
// - Sounds: strudel.cc's defaults from GitHub (dirt samples, drum machines + bank aliases, GM soundfonts), each list
//   given 10 s, so Play never hangs; what failed is listed (loadIssues) and shown. No cache of our own: offline they
//   play only if the browser kept them.
// - 1 cycle = 1 bar; a start at bar n plays the pattern shifted with .early(n), the scheduler starting at 0.
import { aliasBank, evaluate, getAudioContext, getTime, hush, initStrudel, noteToMidi, Hap, Pattern, samples, TimeSpan } from '@strudel/web/web.mjs';
// @ts-expect-error plain JS copied from the WebApp (its bassist.d.mts isn't synced): installBassist(core): void
import { installBassist } from '../../../src/core/bassist.mjs';
import { fullTrackEnd, patchCpm } from '../../../src/core/strudelLength';

const GH = 'https://raw.githubusercontent.com/';
const SOUND_LOAD_TIMEOUT_MS = 10000;
/** bars a full track rings after its end before the scheduler stops */
const RING_CYCLES = 2;

export interface EngineState {
  playing: boolean;
  /** who pressed Play ("patch", "drums") */
  owner: string;
  /** cycles per second of what plays */
  cps: number;
  /** the last bar of a full track (null: loops) */
  end: number | null;
  /** sound lists that didn't load */
  issues: string[];
}

let ready: Promise<unknown> | null = null;
let evalError: Error | null = null;
let offset = 0;
let lastCode = '';
let endTimer: ReturnType<typeof setInterval> | null = null;
let state: EngineState = { playing: false, owner: '', cps: 0.5, end: null, issues: [] };
const listeners = new Set<(s: EngineState) => void>();

const set = (change: Partial<EngineState>) => {
  state = { ...state, ...change };
  listeners.forEach((f) => f(state));
};
export const engineState = () => state;
export function subscribe(f: (s: EngineState) => void): () => void {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

const withTimeout = <T,>(label: string, p: Promise<T>): Promise<T> =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label}: no answer after ${SOUND_LOAD_TIMEOUT_MS / 1000} s`)), SOUND_LOAD_TIMEOUT_MS))]);

/** Starts the engine once (sounds load in its prebake). */
export function initEngine(): Promise<unknown> {
  ready ??= initStrudel({
    onEvalError: (err: Error) => { evalError = err; },
    prebake: async () => {
      const sources: [string, () => Promise<unknown>][] = [
        ['GM soundfonts (gm_*)', () => import('@strudel/soundfonts').then((m) => m.registerSoundfonts())],
        ['dirt samples', () => samples(`${GH}tidalcycles/dirt-samples/main/strudel.json`)],
        ['drum machines', () => samples(`${GH}felixroos/dough-samples/main/tidal-drum-machines.json`)],
        ['drum machine aliases', () => aliasBank(`${GH}todepond/samples/main/tidal-drum-machines-alias.json`)],
      ];
      const results = await Promise.allSettled(sources.map(([label, load]) => withTimeout(label, load())));
      const issues = results.flatMap((r, i) => (r.status === 'rejected' ? [`${sources[i][0]}: ${(r.reason as Error)?.message ?? r.reason}`] : []));
      issues.forEach((x) => console.warn(`[workshop strudel] sounds not loaded: ${x}`));
      set({ issues });
      installBassist({ Pattern, Hap, TimeSpan, noteToMidi }); // .bassist() on the BL songs' bass parts, as in the WebApp
    },
  });
  return ready;
}

/**
 * Resumes the audio context. Must run inside the click, before any await: superdough 1.3.0 never resumes it, and
 * Brave (strict autoplay) doesn't either (the WebApp's finding).
 */
export function resumeAudio(): void {
  try {
    const ctx = getAudioContext();
    if (ctx.state !== 'running') void ctx.resume();
  } catch (e) {
    console.warn(`[workshop strudel] audio not resumed: ${(e as Error).message}`);
  }
}

/** "running", "suspended" (blocked by the browser) or "closed". */
export function audioState(): string {
  try { return getAudioContext().state; } catch { return 'unknown'; }
}

async function evaluateOrThrow(code: string): Promise<unknown> {
  evalError = null;
  const pattern = await evaluate(code);
  if (evalError) {
    const err = evalError;
    evalError = null;
    throw err;
  }
  return pattern;
}

const cpsOf = (code: string) => (patchCpm(code) ?? 30) / 60;
const shifted = (code: string, from: number) => (from > 0 ? `${code}\n.early(${from})` : code);
// a full track (arrange()-built, 2 min or more) ends: no note starts after its last bar
const withEnd = (code: string, end: number | null) => (end === null ? code : `${code}\n.filterWhen((t) => t < ${end})`);

function watchEnd() {
  if (endTimer) clearInterval(endTimer);
  endTimer = null;
  if (state.end === null) return;
  endTimer = setInterval(() => {
    if (state.playing && state.end !== null && cycle() >= state.end + RING_CYCLES) stop();
  }, 200);
}

/**
 * Plays code whose last expression is the pattern, from bar `from` (0 = the start). Call it from the click itself
 * (it resumes the audio first). Throws Strudel's evaluation error.
 */
export async function play(code: string, from = 0, owner = 'patch'): Promise<void> {
  resumeAudio();
  await initEngine();
  hush();
  offset = Math.max(0, from);
  lastCode = code;
  const end = fullTrackEnd(code, 30)?.cycles ?? null;
  try {
    await evaluateOrThrow(shifted(withEnd(code, end), offset));
  } catch (e) {
    hush();
    set({ playing: false });
    throw e;
  }
  set({ playing: true, owner, cps: cpsOf(code), end });
  watchEnd();
}

/** New code while playing: evaluated without restarting the scheduler (the bar goes on). */
export async function update(code: string): Promise<void> {
  if (!state.playing) return play(code, 0, state.owner || 'patch');
  resumeAudio();
  lastCode = code;
  const end = fullTrackEnd(code, 30)?.cycles ?? null;
  await evaluateOrThrow(shifted(withEnd(code, end), offset));
  set({ cps: cpsOf(code), end });
  watchEnd();
}

/** Restarts what plays at bar `to` (0-based). */
export async function seek(to: number): Promise<void> {
  if (!state.playing) return;
  await play(lastCode, to, state.owner);
}

export function stop(): void {
  if (endTimer) clearInterval(endTimer);
  endTimer = null;
  if (ready) hush();
  if (state.playing) set({ playing: false, end: null });
}

/** The bar playing (cycles from the song's start, fractional); 0 when stopped. */
export function cycle(): number {
  if (!state.playing) return 0;
  // the scheduler's time is slightly negative right after a start (its latency): never before bar 0
  try { return Math.max(0, getTime() + offset); } catch { return 0; }
}

interface QHap { whole?: { begin: { valueOf(): number } }; value: unknown; hasOnset(): boolean }

/**
 * The haps a code gives over `cycles` bars, without playing it (what plays is stopped first: evaluating replaces the
 * scheduler's pattern). Onsets only, begin in cycles.
 */
export async function queryHaps(code: string, cycles: number): Promise<{ begin: number; value: Record<string, unknown> }[]> {
  stop();
  await initEngine();
  evalError = null;
  const pattern = (await evaluate(code, false)) as { queryArc?: (a: number, b: number) => QHap[] } | undefined;
  hush();
  if (evalError) {
    const err = evalError;
    evalError = null;
    throw err;
  }
  if (!pattern || typeof pattern.queryArc !== 'function') throw new Error('the code gives no pattern');
  return pattern.queryArc(0, cycles)
    .filter((h) => h.whole && h.hasOnset())
    .map((h) => ({ begin: h.whole!.begin.valueOf(), value: (h.value && typeof h.value === 'object' ? h.value : { s: h.value }) as Record<string, unknown> }));
}
