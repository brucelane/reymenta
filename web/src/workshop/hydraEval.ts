// Running Hydra code (studies/reymenta-workshop.md step 5) without putting Hydra on `window`: hydra-synth is created
// with makeGlobal: false, and the code runs inside `with (synth) { ... }` in a sloppy-mode async function, so `osc`,
// `o0`, `time`, `bpm = 120`, `speed = 2` reach the synth (Hydra's own editor puts them on window instead; here the
// Strudel engine shares the page), `await` works as in Hydra's editor, and the user's `name = value` arguments assign
// globals as they did there. Also the line of an error. Pure: no DOM, no hydra-synth.

export type Compiled = (synth: object) => Promise<unknown>;

const wrap = (code: string) => `return (async () => { with (synth) {\n${code}\n} })()`;

/** The code as a function of the synth; throws a SyntaxError for code that doesn't parse. */
export function compile(code: string): Compiled {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function('synth', wrap(code)) as Compiled;
}

/** compile + run; rejects with the code's error (thrown or rejected). */
export async function run(code: string, synth: object): Promise<void> {
  await compile(code)(synth);
}

/** Where code line 1 sits in the generated function, as the browser numbers it (measured once). */
let offset: number | undefined;
async function lineOffset(): Promise<number | undefined> {
  if (offset !== undefined) return offset;
  try { await run('throw new Error("calibrate")', {}); } catch (e) {
    const l = stackLine(e);
    if (l !== undefined) offset = l - 1;
  }
  return offset;
}

/** The first line number of a Function-generated frame in an error's stack (V8: `<anonymous>:4:7`, Firefox: `Function:4:7`). */
function stackLine(e: unknown): number | undefined {
  const stack = (e as { stack?: unknown })?.stack;
  if (typeof stack !== 'string') return undefined;
  const m = /(?:<anonymous>|> Function):(\d+):\d+/.exec(stack);
  return m ? Number(m[1]) : undefined;
}

/** The code line (1-based) an error comes from, when the browser says (runtime errors; not syntax errors in Chrome). */
export async function errorLine(e: unknown, lines: number): Promise<number | undefined> {
  const at = stackLine(e);
  const off = await lineOffset();
  if (at === undefined || off === undefined) return undefined;
  const l = at - off;
  return l >= 1 && l <= lines ? l : undefined;
}

/** The block around a line (0-based): the lines between empty lines, as in Hydra's editor (Alt+Enter). */
export function blockAt(lines: string[], line: number): { from: number; to: number } {
  let from = line, to = line;
  while (from > 0 && lines[from - 1].trim() !== '') from--;
  while (to < lines.length - 1 && lines[to + 1].trim() !== '') to++;
  return { from, to };
}
