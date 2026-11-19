// The Workshop's drum tab (studies/reymenta-workshop.md step 4): a grid per bar, one row per drum voice, played with
// Strudel's drum machines (`s(arrange(...)).bank(kit)`), and read back from a patch (its pattern's haps quantized to
// the grid). Pure functions, no DOM, no Strudel: the engine (strudelEngine.ts) queries the pattern and hands the haps
// here. Stored in the library as `drums: {<folder>: DrumTab}`, next to the bass tabs.
//
// A bar's hits are a string per voice, one character per step ("x" hit, "." rest): readable in an exported file,
// cheap to validate. Steps per bar = the bar's beats x 4 (16 for 4/4, 14 for 7/8), a cycle = a bar.

/** The rows, in display order (Strudel's drum names, as tidal-drum-machines.json names them). */
export const DRUM_VOICES = ['bd', 'sd', 'hh', 'oh', 'rd', 'cr', 'lt', 'mt', 'ht', 'rim', 'cp'] as const;
export type DrumVoice = (typeof DRUM_VOICES)[number];
export const isDrumVoice = (v: unknown): v is DrumVoice => typeof v === 'string' && (DRUM_VOICES as readonly string[]).includes(v);

export interface DrumBar {
  steps: number;
  /** "x..x...." per voice; a voice with no hit may be missing */
  hits: Partial<Record<DrumVoice, string>>;
}
export interface DrumTab {
  /** the drum machine (Strudel .bank()) */
  kit: string;
  /** the rows shown (used ones and added ones), in DRUM_VOICES order */
  rows: DrumVoice[];
  bars: DrumBar[];
}

/**
 * Drum machines offered in the kit picker: a curated list of tidal-drum-machines.json's banks (71 in all, read from
 * assets/strudel/cache/gh/felixroos/dough-samples/main/tidal-drum-machines.json on 2026-11-19), with the voices each
 * has among DRUM_VOICES (a row the kit lacks plays nothing: shown dimmed). Any other bank name typed into a patch
 * still plays; it's only not offered here.
 */
export const KITS: { id: string; voices: string }[] = [
  { id: 'RolandTR909', voices: 'bd sd hh oh rd cr lt mt ht rim cp' },
  { id: 'RolandTR808', voices: 'bd sd hh oh cr lt mt ht rim cp' },
  { id: 'RolandTR707', voices: 'bd sd hh oh cr lt mt ht rim cp' },
  { id: 'RolandTR606', voices: 'bd sd hh oh cr lt ht' },
  { id: 'RolandTR505', voices: 'bd sd hh oh rd cr lt mt ht rim cp' },
  { id: 'RolandTR626', voices: 'bd sd hh oh rd cr lt mt ht rim cp' },
  { id: 'RolandR8', voices: 'bd sd hh oh rd cr lt mt ht rim cp' },
  { id: 'LinnDrum', voices: 'bd sd hh oh rd cr lt mt ht rim cp' },
  { id: 'LinnLM1', voices: 'bd sd hh oh lt ht rim cp' },
  { id: 'OberheimDMX', voices: 'bd sd hh oh rd cr lt mt ht rim cp' },
  { id: 'AkaiMPC60', voices: 'bd sd hh oh rd cr lt mt ht rim cp' },
  { id: 'EmuSP12', voices: 'bd sd hh oh rd cr lt mt ht rim cp' },
  { id: 'AlesisHR16', voices: 'bd sd hh oh lt ht rim cp' },
  { id: 'CasioRZ1', voices: 'bd sd hh rd cr lt mt ht rim cp' },
  { id: 'BossDR110', voices: 'bd sd hh oh rd cr cp' },
  { id: 'SequentialCircuitsDrumtracks', voices: 'bd sd hh oh rd cr ht rim cp' },
];
export const DEFAULT_KIT = 'RolandTR909';
export const isKit = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(v);
/** Does `kit` have `voice`? true for a kit not in KITS (unknown: assume it does). */
export const kitHas = (kit: string, voice: DrumVoice) => KITS.find((k) => k.id === kit)?.voices.split(' ').includes(voice) ?? true;

export const MAX_DRUM_BARS = 1024;
const MAX_STEPS = 64;

/** Steps in a bar of `beatsPerBar` beats: 16ths (16 for 4/4, 14 for 7/8, 12 for 3/4). */
export const stepsPerBar = (beatsPerBar = 4) => Math.max(1, Math.min(MAX_STEPS, Math.round(beatsPerBar * 4)));

const sortRows = (rows: Iterable<DrumVoice>): DrumVoice[] => DRUM_VOICES.filter((v) => new Set(rows).has(v));
const emptyHits = (steps: number) => '.'.repeat(steps);

export function newDrumTab(o: { beatsPerBar?: number; bars?: number; kit?: string; basic?: boolean } = {}): DrumTab {
  const steps = stepsPerBar(o.beatsPerBar);
  const bar: DrumBar = { steps, hits: {} };
  if (o.basic) {
    // a plain groove to start from: kick on 1 (and 3 in 4/4), snare on the half (2 and 4), 8th hats
    const at = (list: number[]) => Array.from({ length: steps }, (_, i) => (list.includes(i) ? 'x' : '.')).join('');
    const half = Math.round(steps / 2 / 4) * 4;
    bar.hits.bd = at(steps === 16 ? [0, 8] : [0]);
    bar.hits.sd = at(steps === 16 ? [4, 12] : [half]);
    bar.hits.hh = at(Array.from({ length: Math.ceil(steps / 2) }, (_, i) => i * 2));
  }
  return {
    kit: isKit(o.kit) ? o.kit : DEFAULT_KIT,
    rows: ['bd', 'sd', 'hh'],
    bars: Array.from({ length: Math.max(1, Math.min(MAX_DRUM_BARS, o.bars ?? 1)) }, () => ({ steps, hits: { ...bar.hits } })),
  };
}

export const isHit = (bar: DrumBar | undefined, voice: DrumVoice, step: number) => bar?.hits[voice]?.[step] === 'x';

const editBar = (t: DrumTab, index: number, f: (b: DrumBar) => DrumBar): DrumTab =>
  index < 0 || index >= t.bars.length ? t : { ...t, bars: t.bars.map((b, i) => (i === index ? f(b) : b)) };

export function toggleStep(t: DrumTab, bar: number, voice: DrumVoice, step: number): DrumTab {
  return editBar({ ...t, rows: sortRows([...t.rows, voice]) }, bar, (b) => {
    if (step < 0 || step >= b.steps) return b;
    const s = b.hits[voice] ?? emptyHits(b.steps);
    const next = s.slice(0, step) + (s[step] === 'x' ? '.' : 'x') + s.slice(step + 1);
    const hits = { ...b.hits };
    if (next.includes('x')) hits[voice] = next;
    else delete hits[voice];
    return { ...b, hits };
  });
}

export const addRow = (t: DrumTab, voice: DrumVoice): DrumTab => ({ ...t, rows: sortRows([...t.rows, voice]) });
/** Removes a row and its hits. */
export const removeRow = (t: DrumTab, voice: DrumVoice): DrumTab => ({
  ...t,
  rows: t.rows.filter((r) => r !== voice),
  bars: t.bars.map((b) => { const hits = { ...b.hits }; delete hits[voice]; return { ...b, hits }; }),
});
export const setKit = (t: DrumTab, kit: string): DrumTab => (isKit(kit) ? { ...t, kit } : t);

/** An empty bar after `after` (same steps as that bar). */
export function addDrumBar(t: DrumTab, after: number, steps?: number): DrumTab {
  if (t.bars.length >= MAX_DRUM_BARS) return t;
  const at = Math.max(-1, Math.min(t.bars.length - 1, after));
  const bar: DrumBar = { steps: steps ?? t.bars[at]?.steps ?? 16, hits: {} };
  return { ...t, bars: [...t.bars.slice(0, at + 1), bar, ...t.bars.slice(at + 1)] };
}
/** A copy of bar `index` right after it. */
export function copyDrumBar(t: DrumTab, index: number): DrumTab {
  const b = t.bars[index];
  if (!b || t.bars.length >= MAX_DRUM_BARS) return t;
  return { ...t, bars: [...t.bars.slice(0, index + 1), { steps: b.steps, hits: { ...b.hits } }, ...t.bars.slice(index + 1)] };
}
export function removeDrumBar(t: DrumTab, index: number): DrumTab {
  if (t.bars.length <= 1 || index < 0 || index >= t.bars.length) return t;
  return { ...t, bars: t.bars.filter((_, i) => i !== index) };
}

// ---------------------------------------------------------------- code

/** A bar's row as mini-notation, as short as it stays exact: "bd ~ ~ ~ bd ~ ~ ~ ..." -> "bd bd bd bd"; "~" when empty. */
export function barPattern(bar: DrumBar, voice: DrumVoice): string {
  const s = bar.hits[voice] ?? '';
  const hits = [...s].flatMap((c, i) => (c === 'x' && i < bar.steps ? [i] : []));
  if (!hits.length) return '~';
  // the fewest equal slots that still put every hit on a slot start
  for (let n = 1; n <= bar.steps; n++) {
    if (bar.steps % n) continue;
    const per = bar.steps / n;
    if (hits.every((i) => i % per === 0)) return Array.from({ length: n }, (_, k) => (hits.includes(k * per) ? voice : '~')).join(' ');
  }
  return voice; // not reached (n = steps always fits)
}

/** One voice over the whole tab: arrange() entries, equal bars in a row merged ([n, "pattern"]). */
export function rowArrange(t: DrumTab, voice: DrumVoice): [number, string][] {
  const out: [number, string][] = [];
  for (const b of t.bars) {
    const p = barPattern(b, voice);
    const last = out[out.length - 1];
    if (last && last[1] === p) last[0]++;
    else out.push([1, p]);
  }
  return out;
}

const q = (s: string) => JSON.stringify(s);

/**
 * The drums as one Strudel expression: stack(s(arrange(...)), ...).bank("kit"), one entry per voice that plays.
 * "silence" when nothing plays.
 */
export function drumExpression(t: DrumTab): string {
  const rows = sortRows(t.rows).filter((v) => t.bars.some((b) => !!b.hits[v]?.includes('x')));
  if (!rows.length) return 'silence';
  const parts = rows.map((v) => {
    const entries = rowArrange(t, v).map(([n, p]) => `[${n}, ${q(p)}]`);
    return `  s(arrange(${entries.join(', ')}))`;
  });
  return `stack(\n${parts.join(',\n')}\n).bank(${q(t.kit)})`;
}

/** Code that plays the drum tab alone: the tempo (1 cycle = 1 bar) then the expression. */
export function drumCode(t: DrumTab, o: { bpm?: number; beatsPerBar?: number } = {}): string {
  const bpm = o.bpm && o.bpm > 0 ? o.bpm : 120;
  const bpb = o.beatsPerBar && o.beatsPerBar > 0 ? o.beatsPerBar : 4;
  return `// drum tab, ${t.bars.length} bar${t.bars.length > 1 ? 's' : ''}, ${t.kit}\nsetcpm(${bpm}/${bpb})\n${drumExpression(t)}\n`;
}

// ---------------------------------------------------------------- from a pattern

/** The drum voice a hap's value plays, if any: its `s` ("bd", "RolandTR909_bd" once superdough named it, "ch" = hh). */
export function drumVoiceOf(v: Record<string, unknown>): DrumVoice | undefined {
  if (v.note !== undefined || v.freq !== undefined) return undefined;
  let s = typeof v.s === 'string' ? v.s.toLowerCase() : '';
  const bank = typeof v.bank === 'string' ? v.bank.toLowerCase() : '';
  if (bank && s.startsWith(`${bank}_`)) s = s.slice(bank.length + 1);
  if (s === 'ch') s = 'hh';
  return isDrumVoice(s) ? s : undefined;
}

export interface PlainHap { begin: number; value: Record<string, unknown> }

/**
 * Fills a grid from a pattern's haps (onsets only; begin in cycles = bars): drum hits quantized to the nearest step
 * (a hit that rounds to the bar's end goes to the next bar's first step). `bars`: the patch's length (patchCycles),
 * else up to the last hit. The kit is the bank most hits use. Undefined when no hap is a drum.
 */
export function drumTabFromHaps(haps: PlainHap[], o: { bars?: number; beatsPerBar?: number; kit?: string } = {}): DrumTab | undefined {
  const steps = stepsPerBar(o.beatsPerBar);
  const hits: { bar: number; step: number; voice: DrumVoice }[] = [];
  const banks = new Map<string, number>();
  for (const h of haps) {
    const voice = drumVoiceOf(h.value);
    if (!voice || !Number.isFinite(h.begin) || h.begin < 0) continue;
    let bar = Math.floor(h.begin + 1e-9);
    let step = Math.round((h.begin - bar) * steps);
    if (step >= steps) { bar++; step = 0; }
    if (bar >= MAX_DRUM_BARS) continue;
    hits.push({ bar, step, voice });
    if (typeof h.value.bank === 'string') banks.set(h.value.bank, (banks.get(h.value.bank) ?? 0) + 1);
  }
  if (!hits.length) return undefined;
  const last = Math.max(...hits.map((x) => x.bar)) + 1;
  const count = Math.max(1, Math.min(MAX_DRUM_BARS, Math.ceil(o.bars && o.bars > 0 ? Math.max(o.bars - 1e-9, last) : last)));
  const grid = Array.from({ length: count }, () => new Map<DrumVoice, string[]>());
  for (const { bar, step, voice } of hits) {
    if (bar >= count) continue;
    const row = grid[bar].get(voice) ?? Array.from({ length: steps }, () => '.');
    row[step] = 'x';
    grid[bar].set(voice, row);
  }
  const kit = [...banks.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    kit: isKit(kit) ? kit : isKit(o.kit) ? o.kit : DEFAULT_KIT,
    rows: sortRows(hits.map((x) => x.voice)),
    bars: grid.map((m) => ({ steps, hits: Object.fromEntries([...m.entries()].map(([v, r]) => [v, r.join('')])) })),
  };
}

// ---------------------------------------------------------------- validation

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** A stored or imported drum tab -> a clean DrumTab, or an error. */
export function validateDrumTab(raw: unknown): DrumTab | string {
  if (!obj(raw)) return 'not an object';
  if (!isKit(raw.kit)) return 'bad kit';
  if (!Array.isArray(raw.bars) || !raw.bars.length || raw.bars.length > MAX_DRUM_BARS) return 'bad bars';
  const bars: DrumBar[] = [];
  for (const b of raw.bars) {
    if (!obj(b) || typeof b.steps !== 'number' || !Number.isInteger(b.steps) || b.steps < 1 || b.steps > MAX_STEPS) return 'bad bar';
    const hits: DrumBar['hits'] = {};
    if (b.hits !== undefined && !obj(b.hits)) return 'bad hits';
    for (const [k, v] of Object.entries(b.hits ?? {})) {
      if (!isDrumVoice(k)) return `unknown voice ${k.slice(0, 10)}`;
      if (typeof v !== 'string' || v.length !== b.steps || !/^[x.]*$/.test(v)) return `bad hits for ${k}`;
      if (v.includes('x')) hits[k] = v;
    }
    bars.push({ steps: b.steps, hits });
  }
  const rows = Array.isArray(raw.rows) ? raw.rows.filter(isDrumVoice) : [];
  const used = bars.flatMap((b) => Object.keys(b.hits) as DrumVoice[]);
  return { kit: raw.kit, rows: sortRows([...rows, ...used]), bars };
}
