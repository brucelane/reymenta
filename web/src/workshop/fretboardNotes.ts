// The Workshop's fretboard (pure part): instruments and tunings, and what each fret shows for a key.
import { DEGREES, MODES, PITCH_NAMES, type ModeName } from '../../../src/core/scales';

/** Open strings, lowest first, as MIDI keys. */
export const INSTRUMENTS: Record<string, { fr: string; en: string; tunings: Record<string, number[]> }> = {
  bass4: { fr: 'Basse 4 cordes', en: 'Bass, 4 strings', tunings: { EADG: [28, 33, 38, 43], DADG: [26, 33, 38, 43] } },
  bass5: { fr: 'Basse 5 cordes', en: 'Bass, 5 strings', tunings: { BEADG: [23, 28, 33, 38, 43] } },
  guitar: {
    fr: 'Guitare 6 cordes', en: 'Guitar, 6 strings',
    tunings: { EADGBE: [40, 45, 50, 55, 59, 64], 'Drop D': [38, 45, 50, 55, 59, 64], DADGAD: [38, 45, 50, 55, 57, 62], 'Open G': [38, 43, 50, 55, 59, 62] },
  },
};

export interface FretCell { fret: number; key: number; inScale: boolean; root: boolean; label: string }

/** One row per string, highest string first (as a player looks down at the neck). */
export function fretRows(open: number[], root: number, mode: ModeName, frets: number, labels: 'names' | 'degrees'): FretCell[][] {
  const steps = new Set(MODES[mode].steps);
  return [...open].reverse().map((o) =>
    Array.from({ length: frets + 1 }, (_, fret) => {
      const key = o + fret;
      const interval = (((key - root) % 12) + 12) % 12;
      return {
        fret, key, inScale: steps.has(interval), root: interval === 0,
        label: labels === 'degrees' ? DEGREES[interval] : PITCH_NAMES[((key % 12) + 12) % 12],
      };
    }));
}

/** The open strings' names ("E", "A"...), highest first like the rows. */
export const stringNames = (open: number[]) => [...open].reverse().map((k) => PITCH_NAMES[k % 12]);
