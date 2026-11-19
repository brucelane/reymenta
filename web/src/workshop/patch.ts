// A track's Strudel patch in the Workshop (studies/reymenta-workshop.md step 4): the template a new track starts
// from, the drum tab copied into a patch, the checks on a patch file. Pure functions, no DOM, no Strudel.
// Patches follow the repo's convention (assets/glsl/<folder>/<folder>.strudel.js): setcpm(bpm/beats) so that
// 1 cycle = 1 bar, parts built with arrange([bars, "pattern"], ...), the last expression the pattern played,
// an optional "// Sections (bars): A 1-4 | B 5-8" header (src/core/strudelLength.ts patchSections).
import { MODES, PITCH_NAMES, trackTonality } from '../../../src/core/scales';
import { drumExpression, newDrumTab } from './drums';

/** Patches are code typed or downloaded: kept below this (the BL songs are 5-15 KB). */
export const MAX_PATCH_BYTES = 256 * 1024;

/** A patch text from a file or the catalogue: a string, not too large, not an HTML page (a 404 answered by a site). */
export function validatePatch(raw: unknown): string | { error: string } {
  if (typeof raw !== 'string') return { error: 'not text' };
  if (raw.length > MAX_PATCH_BYTES) return { error: 'too large' };
  if (/^\s*<(!doctype|html)/i.test(raw)) return { error: 'an HTML page, not a patch' };
  if (raw.includes('\u0000')) return { error: 'binary file' };
  return raw.replace(/\r\n/g, '\n');
}

/** A note name in octave 2 (bass register, C2..B2), lower case as the patches write them: "e2", "f#2". */
const bassNote = (pc: number) => `${PITCH_NAMES[((pc % 12) + 12) % 12].toLowerCase()}2`;

/**
 * The patch a new track starts from: its tempo (1 cycle = 1 bar of its beats), two 4-bar sections, a basic drum
 * groove (the drum tab's own code) and a bass line on the root, fifth and fourth of its key.
 */
export function templatePatch(o: { title: string; bpm?: number; beatsPerBar?: number; tonality?: string; mode?: string }): string {
  const bpm = o.bpm && o.bpm > 0 ? o.bpm : 120;
  const bpb = o.beatsPerBar && o.beatsPerBar > 0 ? o.beatsPerBar : 4;
  const key = trackTonality(o) ?? { root: 4, mode: 'minor' };
  const steps = MODES[key.mode]?.steps ?? MODES.minor.steps;
  const has = (s: number) => steps.includes(s);
  const fifth = has(7) ? 7 : steps[Math.min(4, steps.length - 1)];
  const fourth = has(5) ? 5 : steps[Math.min(3, steps.length - 1)];
  const [r, f5, f4] = [bassNote(key.root), bassNote(key.root + fifth), bassNote(key.root + fourth)];
  const beats = Math.max(1, Math.round(bpb));
  // one note a beat, the root first and last
  const line = (a: string, b: string) => Array.from({ length: beats }, (_, i) => (i === 0 ? a : i === beats - 1 ? b : i % 2 ? '~' : a)).join(' ');
  const drums = drumExpression(newDrumTab({ beatsPerBar: bpb, bars: 1, basic: true }))
    .replace(/\[1, /g, '[8, '); // the one-bar groove over the 8 bars
  const title = o.title.replace(/[\r\n]+/g, ' ').slice(0, 120);
  return [
    `// ${title}`,
    `// 1 cycle = 1 bar of ${bpb} beats at ${bpm} bpm`,
    '// Sections (bars): A 1-4 | B 5-8',
    `setcpm(${bpm}/${bpb})`,
    '',
    `const drums = ${drums}`,
    '',
    'const bass = note(arrange(',
    `  [4, "${line(r, f5)}"],`,
    `  [4, "${line(f4, r)}"]`,
    ')).sound("gm_electric_bass_pick")',
    '',
    'stack(drums, bass)',
    '',
  ].join('\n');
}

/**
 * The drum tab's code added to a patch: `const <name> = <expression>` before the patch's last top-level
 * `stack(` line, and <name> added first in that stack. A patch made of `$:` blocks gets a new `$:` block instead.
 * undefined when neither is found (the user adds it by hand).
 */
export function addDrumsToPatch(patch: string, expression: string): string | undefined {
  return addToPatch(patch, expression, 'drums');
}

/** addDrumsToPatch for any part: `const <base>` (or <base>2, <base>3...) added to the patch's last stack. */
export function addToPatch(patch: string, expression: string, base: string): string | undefined {
  const lines = patch.replace(/\r\n/g, '\n').split('\n');
  let name = base;
  for (let i = 2; new RegExp(`\\b(const|let|var)\\s+${name}\\b`).test(patch); i++) name = `${base}${i}`;
  const at = lines.map((l, i) => (/^stack\s*\(/.test(l) ? i : -1)).filter((i) => i >= 0).pop();
  if (at !== undefined) {
    const opened = lines[at].replace(/^stack\s*\(\s*/, (m) => `${m}${name}, `).replace(new RegExp(`${name}, \\)`), `${name})`);
    return [...lines.slice(0, at), `const ${name} = ${expression}`, '', opened, ...lines.slice(at + 1)].join('\n');
  }
  if (lines.some((l) => /^\s*\$:/.test(l))) return `${patch.replace(/\s*$/, '')}\n\n$: ${expression}\n`;
  return undefined;
}
