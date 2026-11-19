// Hydra sketches in the Workshop (studies/reymenta-workshop.md step 5): the checks on a sketch from a file or a library,
// the starter sketch, free sketches (not tied to a track). Pure functions, no DOM, no hydra-synth (so the library and
// the Workshop's first screen don't pull the Hydra chunk).
// A sketch is Hydra code (JavaScript), saved as <name>.hydra.js; it runs only when the user presses Run.

/** Hydra sketches are a few lines to a few KB; kept below this. */
export const MAX_HYDRA_BYTES = 64 * 1024;
export const MAX_SKETCHES = 500;

/** A free sketch (the Workshop's Hydra screen), kept in the library's `sketches`. */
export interface Sketch { id: string; title: string; code: string; updatedAt?: string }

/** Sketch code from a file or a library: a string, not too large, not an HTML page, not binary. */
export function validateHydra(raw: unknown): string | { error: string } {
  if (typeof raw !== 'string') return { error: 'not text' };
  if (raw.length > MAX_HYDRA_BYTES) return { error: 'too large' };
  if (/^\s*<(!doctype|html)/i.test(raw)) return { error: 'an HTML page, not a sketch' };
  if (raw.includes('\u0000')) return { error: 'binary file' };
  return raw.replace(/\r\n/g, '\n');
}

const oneLine = (s: string, max: number) => s.replace(/[\r\n\t\u2028\u2029]+/g, ' ').trim().slice(0, max);
export const isSketchId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9-]{1,64}$/.test(v);

/** A free sketch from a library file -> a clean Sketch, or an error. */
export function validateSketch(raw: unknown): Sketch | string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'not an object';
  const r = raw as Record<string, unknown>;
  if (!isSketchId(r.id)) return 'bad id';
  const code = validateHydra(r.code);
  if (typeof code !== 'string') return code.error;
  const s: Sketch = { id: r.id, title: typeof r.title === 'string' && r.title.trim() ? oneLine(r.title, 120) : r.id, code };
  if (typeof r.updatedAt === 'string' && r.updatedAt.length <= 40) s.updatedAt = r.updatedAt;
  return s;
}

/**
 * The sketch a new one starts from: dark (deep violet on black), slow, a pulse on the beat through Hydra's `bpm`
 * (arrays step once a beat) when the track has a tempo.
 */
export function starterSketch(o: { title?: string; bpm?: number } = {}): string {
  const title = (o.title ?? 'Hydra').replace(/[\r\n]+/g, ' ').slice(0, 120);
  const bpm = o.bpm && o.bpm > 0 && o.bpm < 1000 ? Math.round(o.bpm * 100) / 100 : undefined;
  return [
    `// ${title}`,
    '// Ctrl+Enter: the line, Alt+Enter: the block, Ctrl+Shift+Enter: all; Ctrl+Space: complete or expand a shortcut',
    ...(bpm ? [`bpm = ${bpm}`, ''] : ['']),
    'osc(8, 0.03, 0.8)',
    '  .color(0.35, 0.1, 0.6)',
    '  .modulate(noise(2.5, 0.08), 0.35)',
    '  .kaleid(5)',
    `  .scale(${bpm ? '[1, 1.08].fast(0.5)' : '1.04'})`,
    '  .brightness(-0.3)',
    '  .contrast(1.5)',
    '  .out(o0)',
    '',
  ].join('\n');
}

/** <name>.hydra.js */
export const hydraFileName = (name: string) => `${name.replace(/[^\w.-]+/g, '') || 'sketch'}.hydra.js`;
