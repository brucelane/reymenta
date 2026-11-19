// The user's own Hydra shortcuts, brought from his Hydra editor:
//   C:/cpp/hydra/BruceHydrasophiadigitalart.fr/hydra-server/app/src/editor.js, `EditorClass.prototype.autoComplete`
//   (CodeMirror 5, January 2021, no git), bound to Ctrl+Space in that folder's keymaps.js.
// Ctrl+Space looks at the two characters before the cursor, then at the last one, and replaces them with the
// expansion, selecting a range in it (usually the first parameter). The 32 shortcuts below are copied as they were:
// same keys, same text, same selection. The original computed the selection as
//   from = start + a,  to = start + keyLength + b   (start = where the key began; a, b = its `pos1.ch +=`, `pos2.ch +=`)
// so `a` and `b` are kept as written there. Keys without a selection ({ ( [) left the cursor after the text.
// Pure: no CodeMirror, no DOM (bound to the editor in HydraSection.tsx).
//
// One change, in when they apply (not in what they insert): a letter or digit key preceded by a letter, digit, _ or $
// doesn't expand (the original turned "pos" + Ctrl+Space into "poMath.sin(time)"); there Ctrl+Space opens the
// completion list instead. `expand(text, { strict: false })` gives the original behaviour.

export interface Shortcut {
  key: string;
  text: string;
  /** the original's pos1.ch / pos2.ch offsets; undefined: no selection set (the cursor ends after the text) */
  a?: number;
  b?: number;
  /** the original's comment above it */
  group: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  // 2 characters
  { key: 'mx', text: 'modulateRepeatX(osc(10), reps = 5.0, offset = () => Math.sin(time) * 5)', a: 16, b: 17, group: 'hydra' },
  { key: 'my', text: 'modulateRepeatY(osc(10), reps = 5.0, offset = () => Math.sin(time) * 5)', a: 16, b: 17, group: 'hydra' },
  { key: 'mr', text: 'modulateRotate(noise(10), multiple = 1.0, offset = 1.0)', a: 15, b: 18, group: 'hydra' },
  { key: 'mk', text: 'modulateKaleid(o0, sides = 5.0)', a: 15, b: 15, group: 'hydra' },
  { key: 'ms', text: 'modulateScale(osc(10), multiple = 1.0, offset = 1.0)', a: 14, b: 15, group: 'hydra' },
  { key: 'mp', text: 'modulatePixelate(osc(10), multiple = 1.0, offset = 1.0)', a: 17, b: 19, group: 'hydra' },
  { key: 'sa', text: 'saturate(0.1)', a: 9, b: 10, group: 'hydra' },
  { key: 'la', text: 'layer(shape(7))', a: 9, b: 10, group: 'hydra' },
  { key: 'ch', text: 'chromatic(o0, offsetX = 0.1, offsetY = 0.1)', a: 10, b: 11, group: 'hydra' },
  { key: 'sx', text: 'modulateScrollX(o0, scrollX = 0.1, speed = 0.01)', a: 16, b: 16, group: 'hydra' },
  { key: 'sy', text: 'modulateScrollY(o0, scrollY = 0.1, speed = 0.01)', a: 16, b: 16, group: 'hydra' },
  // 1 character: frag vars
  { key: '2', text: 'vec2 vv = vec2(0.0, 0.0);', a: 5, b: 6, group: 'frag vars' },
  { key: '3', text: 'vec3 vvv = vec3(0.0, 0.0, 0.0);', a: 5, b: 7, group: 'frag vars' },
  { key: '4', text: 'vec4 vvvv = vec4(0.0, 0.0, 0.0, 0.0);', a: 5, b: 8, group: 'frag vars' },
  { key: '1', text: 'float f = 0.0;', a: 6, b: 6, group: 'frag vars' },
  { key: '{', text: '{;}', group: 'frag vars' },
  { key: '(', text: '()', group: 'frag vars' },
  { key: '[', text: '[]', group: 'frag vars' },
  // frag functions
  { key: 'f', text: 'float fcf(in vec3 pos) {float f = 0.0;return f;}', a: 6, b: 8, group: 'frag functions' },
  { key: 'g', text: 'vec2 fc2(in vec3 pos) {vec2 vv = vec2(0.0, 0.0);return vv;}', a: 5, b: 7, group: 'frag functions' },
  { key: 'h', text: 'vec3 fc3(in vec3 pos) {vec3 vvv = vec3(0.0, 0.0, 0.0);return vvv;}', a: 5, b: 7, group: 'frag functions' },
  { key: 'j', text: 'vec4 fc4(in vec3 pos) {vec4 vvvv = vec4(0.0, 0.0, 0.0, 0.0);return vvvv;}', a: 5, b: 7, group: 'frag functions' },
  // hydra functions
  { key: 't', text: '() => Math.sin(time) * 1.0', a: 23, b: 23, group: 'hydra functions' },
  { key: 'a', text: '() => a.fft[1] * 1.0', a: 12, b: 12, group: 'hydra functions' },
  { key: 'm', text: '() => cc[11] * 1.0', a: 10, b: 10, group: 'hydra functions' },
  // for
  { key: 'r', text: 'for (int i=0; i<2 ;i++) { }', a: 25, b: 25, group: 'for' },
  { key: 's', text: 'Math.sin(time)', a: 4, b: 7, group: 'for' },
  { key: 'c', text: 'Math.cos(time)', a: 4, b: 7, group: 'for' },
  // if
  { key: '=', text: 'if (i==0.0) { } else { }', a: 13, b: 13, group: 'if' },
  { key: '>', text: 'if (i>0.0) { } else { }', a: 12, b: 12, group: 'if' },
  { key: '<', text: 'if (i<0.0) { } else { }', a: 12, b: 12, group: 'if' },
  // the original's template literal, its indentation included
  { key: '#', text: '#if V==1\n          #else\n          #endif', a: 4, b: 4, group: 'if' },
];

export interface Expansion {
  /** characters before the cursor to replace (the key) */
  length: number;
  insert: string;
  /** the selection after the change, as offsets from where the key began */
  from: number;
  to: number;
  key: string;
}

const BY_KEY = new Map(SHORTCUTS.map((s) => [s.key, s]));
const WORD = /[\w$]/;

function make(s: Shortcut): Expansion {
  const n = s.key.length;
  if (s.a === undefined || s.b === undefined) return { length: n, insert: s.text, from: s.text.length, to: s.text.length, key: s.key };
  return { length: n, insert: s.text, from: s.a, to: n + s.b, key: s.key };
}

/**
 * The expansion for the text before the cursor (its line is enough), or undefined: two characters first, then one,
 * like the original. `strict` (default): a letter/digit key must not follow a letter, digit, _ or $.
 */
export function expand(textBefore: string, { strict = true }: { strict?: boolean } = {}): Expansion | undefined {
  const free = (keyLen: number) => {
    if (!strict) return true;
    const key = textBefore.slice(-keyLen);
    if (!/^[A-Za-z0-9]/.test(key)) return true;
    const before = textBefore.charAt(textBefore.length - keyLen - 1);
    return !before || !WORD.test(before);
  };
  if (textBefore.length >= 2) {
    const s = BY_KEY.get(textBefore.slice(-2));
    if (s && free(2)) return make(s);
  }
  if (textBefore.length >= 1) {
    const s = BY_KEY.get(textBefore.slice(-1));
    if (s && s.key.length === 1 && free(1)) return make(s);
  }
  return undefined;
}
