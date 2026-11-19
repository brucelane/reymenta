// Scales and modes for the bass fretboard pane, and a key guess from played notes.
// Pure functions (no DOM), like songGrid.ts.

export const PITCH_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** Scale steps in semitones from the root. major/minor first: they're what the guess returns. */
export const MODES: Record<string, { label: string; steps: number[] }> = {
  major: { label: "major (ionian)", steps: [0, 2, 4, 5, 7, 9, 11] },
  minor: { label: "minor (aeolian)", steps: [0, 2, 3, 5, 7, 8, 10] },
  dorian: { label: "dorian", steps: [0, 2, 3, 5, 7, 9, 10] },
  phrygian: { label: "phrygian", steps: [0, 1, 3, 5, 7, 8, 10] },
  lydian: { label: "lydian", steps: [0, 2, 4, 6, 7, 9, 11] },
  mixolydian: { label: "mixolydian", steps: [0, 2, 4, 5, 7, 9, 10] },
  locrian: { label: "locrian", steps: [0, 1, 3, 5, 6, 8, 10] },
  harmonicMinor: { label: "harmonic minor", steps: [0, 2, 3, 5, 7, 8, 11] },
  melodicMinor: { label: "melodic minor", steps: [0, 2, 3, 5, 7, 9, 11] },
  majorPenta: { label: "major pentatonic", steps: [0, 2, 4, 7, 9] },
  minorPenta: { label: "minor pentatonic", steps: [0, 3, 5, 7, 10] },
  blues: { label: "blues", steps: [0, 3, 5, 6, 7, 10] },
};
export type ModeName = keyof typeof MODES;
export const isModeName = (m: unknown): m is ModeName => typeof m === "string" && Object.prototype.hasOwnProperty.call(MODES, m);

/** Interval names by semitone, for the "degrees" display. */
export const DEGREES = ["1", "b2", "2", "b3", "3", "4", "b5", "5", "b6", "6", "b7", "7"];

export interface Tonality {
  root: number; // pitch class, 0 = C
  mode: ModeName;
}

const FLATS: Record<string, string> = { DB: "C#", EB: "D#", GB: "F#", AB: "G#", BB: "A#" };

/**
 * A Track.tonality string -> Tonality: "E" (major), "Em" / "E minor", "F# dorian", "Bb".
 * null when it can't be read.
 */
export function parseTonality(s: string | undefined | null): Tonality | null {
  const m = /^\s*([A-Ga-g])([#b]?)\s*(.*)$/.exec(s ?? "");
  if (!m) return null;
  let name = m[1].toUpperCase() + m[2];
  name = FLATS[name.toUpperCase()] ?? name;
  const root = PITCH_NAMES.indexOf(name);
  if (root < 0) return null;
  const rest = m[3].trim().toLowerCase().replace(/\s+/g, "");
  if (rest === "" || rest === "maj" || rest === "major" || rest === "ionian") return { root, mode: "major" };
  if (rest === "m" || rest === "min" || rest === "minor" || rest === "aeolian") return { root, mode: "minor" };
  const mode = (Object.keys(MODES) as ModeName[]).find(
    (k) => k.toLowerCase() === rest || MODES[k].label.replace(/\s+/g, "") === rest
  );
  return mode ? { root, mode } : null;
}

/** A track's key: its "mode" field when set (track.json), else what "tonality" says. */
export function trackTonality(t: { tonality?: string; mode?: string } | null | undefined): Tonality | null {
  const parsed = parseTonality(t?.tonality);
  if (!parsed) return null;
  // own keys only: "constructor" or "__proto__" are "in" MODES too, and crashed the render
  return t?.mode && isModeName(t.mode) ? { root: parsed.root, mode: t.mode } : parsed;
}

/** Tonality -> the Track.tonality string: "E", "Em", "E dorian". */
export function formatTonality(t: Tonality): string {
  const n = PITCH_NAMES[t.root];
  if (t.mode === "major") return n;
  if (t.mode === "minor") return `${n}m`;
  return `${n} ${MODES[t.mode].label}`;
}

/** Pitch classes in the scale. */
export function scalePitches(t: Tonality): Set<number> {
  return new Set(MODES[t.mode].steps.map((s) => (t.root + s) % 12));
}

/** How long each pitch class sounds (in beats) in a list of notes. */
export function pitchHistogram(notes: { key: number; dur?: number }[]): number[] {
  const h = new Array(12).fill(0);
  for (const n of notes) h[((n.key % 12) + 12) % 12] += n.dur && n.dur > 0 ? n.dur : 1;
  return h;
}

// Krumhansl-Kessler key profiles (probe-tone ratings), index 0 = the tonic
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function correlation(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((x, y) => x + y, 0) / n;
  const mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : 0;
}

export interface KeyGuess extends Tonality {
  score: number; // correlation, -1..1
  outside: number; // share of the notes' time outside the scale, 0..1
}

/**
 * The most likely major/minor keys for a pitch histogram (Krumhansl-Schmuckler), best first.
 * Empty when there are no notes.
 */
export function guessKeys(hist: number[], count = 3): KeyGuess[] {
  const total = hist.reduce((x, y) => x + y, 0);
  if (!total) return [];
  const out: KeyGuess[] = [];
  for (let root = 0; root < 12; root++) {
    for (const [mode, profile] of [["major", MAJOR_PROFILE], ["minor", MINOR_PROFILE]] as const) {
      const rotated = hist.map((_, i) => hist[(i + root) % 12]);
      const scale = scalePitches({ root, mode });
      const outsideTime = hist.reduce((acc, v, pc) => acc + (scale.has(pc) ? 0 : v), 0);
      out.push({ root, mode, score: correlation(rotated, profile), outside: outsideTime / total });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, count);
}
