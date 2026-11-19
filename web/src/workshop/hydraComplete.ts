// Autocompletion for the Workshop's Hydra editor (studies/reymenta-workshop.md step 5). Every Hydra function comes from
// hydra-synth's own definitions (src/glsl/glsl-functions.js: name, type, inputs with defaults), so the list follows the
// installed version and is never kept by hand; only Hydra's runtime API (out, render, hush, sources, audio), which
// isn't in that file, is listed below. Pure: no CodeMirror, no DOM (HydraSection.tsx turns these into CM6 snippets
// and a signature tooltip).
import glslFunctions from 'hydra-synth/src/glsl/glsl-functions.js';

export type HydraKind = 'src' | 'coord' | 'color' | 'combine' | 'combineCoord' | 'api';
export interface HydraParam { name: string; value: string }
export interface HydraFn {
  name: string;
  kind: HydraKind;
  /** the parameters as JavaScript sees them (combine functions take a texture first) */
  params: HydraParam[];
  /** chained after a source (`.rotate()`), else called alone (`osc()`) */
  method: boolean;
  /** one line: what it is */
  doc: string;
}

const KIND_DOC: Record<string, string> = {
  src: 'source', coord: 'coordinates', color: 'colour', combine: 'blend with a texture', combineCoord: 'modulate by a texture',
};

/** Hydra's own globals (and its sources, below): never written as `name = value` in a call (that would assign them, e.g. `speed`, `a`). */
const RUNTIME = ['time', 'bpm', 'speed', 'width', 'height', 'fps', 'mouse', 'a', 'update', 'afterUpdate', 'stats', 'render',
  'hush', 'tick', 'setResolution', 'screencap', 'vidRecorder', 'setFunction', 'loadScript',
  's0', 's1', 's2', 's3', 'o0', 'o1', 'o2', 'o3'];

const fmt = (v: unknown): string => {
  if (v === null || v === undefined) return 'o0';
  if (Array.isArray(v)) return `[${v.map(fmt).join(', ')}]`;
  return String(v);
};

/** The runtime API, not in glsl-functions.js (hydra-synth.js, hydra-source.js, lib/audio.js). */
const API: HydraFn[] = [
  { name: 'out', kind: 'api', method: true, params: [{ name: 'output', value: 'o0' }], doc: 'render the chain to an output' },
  { name: 'render', kind: 'api', method: false, params: [{ name: 'output', value: 'o0' }], doc: 'show one output (no argument: all four)' },
  { name: 'hush', kind: 'api', method: false, params: [], doc: 'clear every output' },
  { name: 'initCam', kind: 'api', method: true, params: [{ name: 'index', value: '0' }], doc: 'source: the camera (s0.initCam())' },
  { name: 'initImage', kind: 'api', method: true, params: [{ name: 'url', value: "'https://'" }], doc: 'source: an image' },
  { name: 'initVideo', kind: 'api', method: true, params: [{ name: 'url', value: "'https://'" }], doc: 'source: a video' },
  { name: 'initScreen', kind: 'api', method: true, params: [], doc: 'source: a screen capture' },
  { name: 'setResolution', kind: 'api', method: false, params: [{ name: 'width', value: '1280' }, { name: 'height', value: '720' }], doc: 'the canvas size' },
  { name: 'setBins', kind: 'api', method: true, params: [{ name: 'bins', value: '4' }], doc: 'audio: number of FFT bins (a.setBins())' },
  { name: 'setSmooth', kind: 'api', method: true, params: [{ name: 'smooth', value: '0.4' }], doc: 'audio: smoothing 0..1 (a.setSmooth())' },
  { name: 'setCutoff', kind: 'api', method: true, params: [{ name: 'cutoff', value: '2' }], doc: 'audio: noise floor (a.setCutoff())' },
  { name: 'setScale', kind: 'api', method: true, params: [{ name: 'scale', value: '10' }], doc: 'audio: range (a.setScale())' },
  { name: 'fast', kind: 'api', method: true, params: [{ name: 'speed', value: '1' }], doc: 'array: step speed ([1, 2].fast())' },
  { name: 'smooth', kind: 'api', method: true, params: [{ name: 'smooth', value: '1' }], doc: 'array: glide between values' },
  { name: 'ease', kind: 'api', method: true, params: [{ name: 'ease', value: "'linear'" }], doc: 'array: easing' },
  { name: 'offset', kind: 'api', method: true, params: [{ name: 'offset', value: '0.5' }], doc: 'array: phase' },
  { name: 'fit', kind: 'api', method: true, params: [{ name: 'low', value: '0' }, { name: 'high', value: '1' }], doc: 'array: rescale' },
];

let cache: HydraFn[] | undefined;

/** Every Hydra function: hydra-synth's own list, then the runtime API (names already there are skipped). */
export function hydraFunctions(): HydraFn[] {
  if (cache) return cache;
  const out: HydraFn[] = [];
  for (const f of glslFunctions()) {
    const kind = f.type as HydraKind;
    const params: HydraParam[] = f.inputs.map((i) => ({ name: i.name, value: fmt(i.default) }));
    if (kind === 'combine' || kind === 'combineCoord') params.unshift({ name: 'texture', value: 'o0' });
    out.push({ name: f.name, kind, params, method: kind !== 'src', doc: KIND_DOC[kind] ?? kind });
  }
  for (const f of API) if (!out.some((x) => x.name === f.name)) out.push(f);
  return (cache = out);
}

// only the sources become synth globals (generator-factory.js); chained functions don't
const reserved = () => new Set([...RUNTIME, ...hydraFunctions().filter((f) => f.kind === 'src').map((f) => f.name)]);
let reservedCache: Set<string> | undefined;

/** `osc(frequency = 60, sync = 0.1, offset = 0)` */
export const signature = (f: HydraFn) => `${f.name}(${f.params.map((p) => `${p.name} = ${p.value}`).join(', ')})`;

/**
 * The CodeMirror 6 snippet a completion inserts: the user's style, `name(param = default, ...)`, each default a field
 * (`${1:60}`) so Tab goes from one to the next and the first is selected. A parameter named like a Hydra global or
 * function (`speed`, `a`, `scale`, a texture) is written as its value only, since `speed = 0.01` in a call sets Hydra's
 * speed. No parameter: `name()`.
 */
export function snippetFor(f: HydraFn): string {
  reservedCache ??= reserved();
  const esc = (s: string) => s.replace(/[$#{}\\]/g, (c) => `\\${c}`);
  if (!f.params.length) return `${f.name}()`;
  // numbered fields: `${60}` alone would be field number 60, with no text
  const args = f.params.map((p, i) => {
    const field = '${' + (i + 1) + ':' + esc(p.value) + '}';
    return p.name === 'texture' || reservedCache!.has(p.name) ? field : `${p.name} = ${field}`;
  });
  return `${f.name}(${args.join(', ')})`;
}

export interface HydraOption { label: string; detail: string; info: string; snippet: string; boost: number; kind: HydraKind }

/** The completion list: after a `.`, the chained functions first; elsewhere the sources first. */
export function hydraOptions(afterDot: boolean): HydraOption[] {
  return hydraFunctions().map((f) => ({
    label: f.name,
    detail: `(${f.params.map((p) => `${p.name} = ${p.value}`).join(', ')})`,
    info: `${f.doc}${f.kind !== 'api' ? ` (${f.kind})` : ''}`,
    snippet: snippetFor(f),
    boost: f.method === afterDot ? 1 : -1,
    kind: f.kind,
  }));
}

/**
 * The call the cursor is in, from the text before it: the function's name, which argument (0-based), and whether it's
 * chained (`.rotate(`). Scans back over (), [] and {} (strings aren't parsed: a bracket inside quotes can confuse it);
 * an array or a bare group around the cursor counts as one argument of the call outside it.
 */
export function callAt(textBefore: string, maxScan = 2000): { name: string; arg: number; method: boolean } | undefined {
  let depth = 0;
  let commas = 0;
  const stop = Math.max(0, textBefore.length - maxScan);
  for (let i = textBefore.length - 1; i >= stop; i--) {
    const c = textBefore[i];
    if (c === ')' || c === ']' || c === '}') { depth++; continue; }
    if (c === '(' || c === '[' || c === '{') {
      if (depth > 0) { depth--; continue; }
      if (c === '(') {
        const m = /([A-Za-z_$][\w$]*)\s*$/.exec(textBefore.slice(Math.max(stop, i - 80), i));
        if (m) {
          const before = textBefore.slice(0, i - m[0].length).replace(/\s+$/, '');
          return { name: m[1], arg: commas, method: before.endsWith('.') };
        }
      }
      // a group, an array, an object or an arrow function's body: one argument of the call outside
      commas = 0;
      continue;
    }
    if (c === ',' && depth === 0) commas++;
    if (c === ';' && depth === 0) return undefined;
  }
  return undefined;
}

/** The parameter hint for the cursor: the function and the argument it's on, if it's a Hydra function. */
export function hintAt(textBefore: string): { fn: HydraFn; arg: number } | undefined {
  const c = callAt(textBefore);
  if (!c) return undefined;
  const fns = hydraFunctions().filter((f) => f.name === c.name);
  const fn = fns.find((f) => f.method === c.method) ?? fns[0];
  return fn && fn.params.length ? { fn, arg: c.arg } : undefined;
}
