// Pitch detection for the tuner and the practice "listen" / "step" modes (2026-11-20). Pure functions, no DOM:
// test/tuner.test.ts.
// McLeod Pitch Method (normalised square difference + the first key maximum above a threshold, parabolic peak):
// it holds a bass's low E (41 Hz) and B (31 Hz) with a 4096-sample window at 48 kHz (~85 ms, 2.6 periods of B0),
// where a plain FFT peak would jump an octave (the fundamental of a bass string is weaker than its 2nd harmonic).

export interface Pitch { freq: number; clarity: number; rms: number }

export const MIN_FREQ = 28; // under A0 (27.5 Hz): a 5-string's low B is 30.9 Hz
export const MAX_FREQ = 1400; // a guitar's 24th fret on the high E is 1319 Hz

/**
 * The fundamental of `buf` (mono samples), or undefined when it's too quiet or unclear.
 * `minRms`: silence gate; `threshold`: the share of the highest NSDF peak a key maximum must reach (0.9 = MPM's).
 */
export function detectPitch(buf: Float32Array, sampleRate: number, o: { minRms?: number; threshold?: number; minFreq?: number; maxFreq?: number } = {}): Pitch | undefined {
  const n = buf.length;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += buf[i] * buf[i];
  const rms = Math.sqrt(sum / n);
  if (rms < (o.minRms ?? 0.01)) return undefined;
  const minLag = Math.max(2, Math.floor(sampleRate / (o.maxFreq ?? MAX_FREQ)));
  const maxLag = Math.min(n - 2, Math.ceil(sampleRate / (o.minFreq ?? MIN_FREQ)));
  if (maxLag <= minLag) return undefined;

  // NSDF(τ) = 2 Σ x[i]x[i+τ] / Σ (x[i]² + x[i+τ]²), 1 = a perfect repeat
  const nsdf = new Float32Array(maxLag + 2);
  for (let tau = 0; tau <= maxLag + 1; tau++) {
    let acf = 0, m = 0;
    for (let i = 0; i + tau < n; i++) {
      const a = buf[i], b = buf[i + tau];
      acf += a * b;
      m += a * a + b * b;
    }
    nsdf[tau] = m > 0 ? (2 * acf) / m : 0;
  }

  // key maxima: the highest point between each positive-going and negative-going zero crossing
  const peaks: number[] = [];
  let tau = 1;
  while (tau < maxLag && nsdf[tau] > 0) tau++; // skip the first lobe (around τ = 0)
  while (tau < maxLag) {
    while (tau < maxLag && nsdf[tau] <= 0) tau++;
    let best = -1;
    while (tau < maxLag && nsdf[tau] > 0) {
      if (tau >= minLag && (best < 0 || nsdf[tau] > nsdf[best])) best = tau;
      tau++;
    }
    if (best > 0) peaks.push(best);
  }
  if (!peaks.length) return undefined;
  const highest = Math.max(...peaks.map((p) => nsdf[p]));
  const cut = highest * (o.threshold ?? 0.9);
  const pick = peaks.find((p) => nsdf[p] >= cut)!;

  // parabolic interpolation around the peak
  const a = nsdf[pick - 1], b = nsdf[pick], c = nsdf[pick + 1];
  const den = a - 2 * b + c;
  const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
  const lag = pick + Math.max(-0.5, Math.min(0.5, shift));
  const clarity = Math.min(1, b - 0.25 * (a - c) * shift);
  const freq = sampleRate / lag;
  if (freq < (o.minFreq ?? MIN_FREQ) || freq > (o.maxFreq ?? MAX_FREQ)) return undefined;
  return { freq, clarity, rms };
}

/** Frequency -> fractional MIDI key (A4 = 69 at `a4` Hz). */
export const freqToMidi = (freq: number, a4 = 440) => 69 + 12 * Math.log2(freq / a4);
/** MIDI key -> frequency. */
export const midiToFreq = (key: number, a4 = 440) => a4 * 2 ** ((key - 69) / 12);

const NAMES_FR = ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const NAMES_EN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
/** "E1", "A#2" (or "Mi1" in French); octave numbers as MIDI's (C4 = 60, the bass's open E = E1). */
export const keyName = (key: number, fr = false) => `${(fr ? NAMES_FR : NAMES_EN)[((key % 12) + 12) % 12]}${Math.floor(key / 12) - 1}`;

/** The nearest semitone and how far from it, in cents (-50..50). */
export function nearest(freq: number, a4 = 440): { key: number; cents: number } {
  const m = freqToMidi(freq, a4);
  const key = Math.round(m);
  return { key, cents: (m - key) * 100 };
}

/** The string of `open` (MIDI keys) closest to `freq`, and the cents off its open pitch. */
export function nearestString(freq: number, open: number[], a4 = 440): { index: number; cents: number } {
  const m = freqToMidi(freq, a4);
  let index = 0;
  open.forEach((k, i) => { if (Math.abs(m - k) < Math.abs(m - open[index])) index = i; });
  return { index, cents: (m - open[index]) * 100 };
}

/** The same note for a practice check: exact, or an octave off (the detector or a harmonic can jump an octave). */
export const sameNote = (heard: number, wanted: number) => {
  const d = Math.round(heard) - wanted;
  return d === 0 || d === 12 || d === -12;
};

/**
 * Smooths readings for the needle: a median of the last few (drops the odd octave jump), in fractional MIDI keys.
 * Returns undefined until `size` readings are in.
 */
export class Smoother {
  private list: number[] = [];
  constructor(private readonly size = 5) {}
  push(m: number | undefined): number | undefined {
    if (m === undefined) { this.list = []; return undefined; }
    this.list.push(m);
    if (this.list.length > this.size) this.list.shift();
    if (this.list.length < Math.min(3, this.size)) return undefined;
    const s = [...this.list].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  }
}
