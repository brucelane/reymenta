// Hydra on a phone (studies/reymenta-workshop.md step 5, touch): the pieces of HydraSection that don't need the DOM.
// - the extra keys shown above the phone keyboard;
// - the number under the cursor and its ± step (by its last decimal place: 0.1 steps 0.1, 60 steps 1);
// - the Live runner: the whole sketch re-run a moment after the last edit; when the new code fails, the last working
//   version keeps running (re-run if the failed code had started running) and the error is reported; Live only after
//   an explicit first Run (code from a file or the catalogue is not run by itself).
// Pure: timers and the runner are injected, so node:test drives them.

/** The extra keys above the phone keyboard, inserted at the cursor as they read. */
export const EXTRA_KEYS = ['(', ')', '.', ',', '=', '=>', '"', "'", '[', ']', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] as const;

export interface NumberAt {
  /** offsets in the line (to exclusive), the minus sign included when it belongs to the number */
  from: number; to: number;
  text: string; value: number;
  /** digits after the decimal point: the step is 10^-decimals */
  decimals: number;
}

const IDENT = /[\w$]/;
const NUM = /^(\d+\.?\d*|\.\d+)$/;

/**
 * The number literal at offset `pos` of `line` (the cursor inside it or touching either end), or undefined.
 * Digits that end an identifier (`o0`, `s1`, `x2`) are not numbers. A leading minus counts when it's a sign
 * (`(-0.5`, `= -1`, `, -2`), not a subtraction (`a-1`, `time-1`, `)-1`).
 */
export function numberAt(line: string, pos: number): NumberAt | undefined {
  const isNum = (c: string | undefined) => c !== undefined && /[\d.]/.test(c);
  let p = Math.max(0, Math.min(line.length, pos));
  // cursor between two characters: prefer the number on the left, else the one on the right
  if (!isNum(line[p - 1]) && isNum(line[p])) p++;
  if (!isNum(line[p - 1])) return undefined;
  let from = p - 1, to = p;
  while (from > 0 && isNum(line[from - 1])) from--;
  while (to < line.length && isNum(line[to])) to++;
  // `1e3`, `0x1f`, `2px`: a number glued to letters isn't one we step
  if (to < line.length && IDENT.test(line[to])) return undefined;
  const digits = line.slice(from, to);
  if (!NUM.test(digits)) return undefined;
  if (from > 0 && IDENT.test(line[from - 1])) return undefined;
  if (from > 0 && line[from - 1] === '-') {
    let b = from - 2;
    while (b >= 0 && line[b] === ' ') b--;
    if (b < 0 || !/[\w$)\].'"`]/.test(line[b])) from--;
  }
  const text = line.slice(from, to);
  const dot = digits.indexOf('.');
  return { from, to, text, value: Number(text), decimals: dot < 0 ? 0 : digits.length - dot - 1 };
}

/** `n` stepped once in direction `dir` (+1 / -1) by its last decimal place, written with the same decimals. */
export function stepNumber(n: Pick<NumberAt, 'text' | 'decimals'>, dir: 1 | -1): string {
  const scale = 10 ** n.decimals;
  const k = Math.round(Number(n.text) * scale) + dir;
  let out = (k / scale).toFixed(n.decimals);
  if (out === '-0' || /^-0\.0*$/.test(out)) out = out.slice(1);
  const digits = n.text.replace(/^-/, '');
  if (digits.startsWith('.')) out = out.replace(/^(-?)0\./, '$1.'); // `.5` stays `.6`
  if (digits.endsWith('.')) out += '.'; // `1.` stays `2.`
  return out;
}

/** The change to apply for a ± step at offset `pos` of `line` (offsets in the line), or undefined off a number. */
export function nudge(line: string, pos: number, dir: 1 | -1): { from: number; to: number; insert: string } | undefined {
  const n = numberAt(line, pos);
  return n ? { from: n.from, to: n.to, insert: stepNumber(n, dir) } : undefined;
}

// ------------------------------------------------------------ Live

export const LIVE_DELAY_MS = 500;
/** the ± stepper: short, so it feels like a knob */
export const LIVE_NUDGE_MS = 120;

export interface LiveDeps {
  /** throws a SyntaxError when the code doesn't parse (nothing ran) */
  parse: (code: string) => void;
  /** runs the whole sketch; rejects with its error */
  run: (code: string) => Promise<void>;
  /** the code now running */
  onOk: (code: string) => void;
  /** the code failed; `kept` = the last working version is (still, or again) running */
  onError: (e: unknown, code: string, kept: boolean) => void;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (id: unknown) => void;
}

/** The Live switch's logic: debounce, one run at a time, the latest code wins, rollback to the last working code. */
export class LiveRunner {
  private on = false;
  private armed = false;
  private timer: unknown;
  private busy = false;
  private waiting: string | undefined;
  private good: string | undefined;
  private tried: string | undefined;

  constructor(private deps: LiveDeps) {}

  /** the switch can be on only once the sketch was run by hand */
  get enabled() { return this.on && this.armed; }
  get lastGood() { return this.good; }

  setEnabled(on: boolean) { this.on = on; if (!this.enabled) this.cancel(); }
  /** an explicit Run happened (of the whole sketch when `code` is given and it ran fine) */
  arm(code?: string) { this.armed = true; if (code !== undefined) { this.good = code; this.tried = code; } }
  /** new code from a file or the catalogue: Live waits for the next explicit Run */
  disarm() { this.armed = false; this.good = undefined; this.tried = undefined; this.cancel(); }

  /** the code changed: run it after `delay` ms of quiet (when Live is on) */
  edit(code: string, delay = LIVE_DELAY_MS) {
    if (!this.enabled) return;
    this.cancel();
    this.timer = this.deps.setTimer(() => { this.timer = undefined; void this.fire(code); }, delay);
  }

  cancel() {
    if (this.timer !== undefined) this.deps.clearTimer(this.timer);
    this.timer = undefined;
  }

  /** runs `code` now (one run at a time: a newer code waits for the current run, older waiting code is dropped) */
  async fire(code: string): Promise<void> {
    if (!this.enabled) return;
    if (this.busy) { this.waiting = code; return; }
    if (code === this.tried) return;
    this.busy = true;
    this.tried = code;
    try {
      let parsed = false;
      try {
        this.deps.parse(code);
        parsed = true;
        await this.deps.run(code);
        this.good = code;
        this.deps.onOk(code);
      } catch (e) {
        const good = this.good;
        let kept = good !== undefined;
        // a syntax error ran nothing; a runtime error may have half run: the last working code again
        if (parsed && good !== undefined) {
          try { await this.deps.run(good); } catch { kept = false; }
        }
        this.deps.onError(e, code, kept);
      }
    } finally {
      this.busy = false;
    }
    const next = this.waiting;
    this.waiting = undefined;
    if (next !== undefined) await this.fire(next);
  }
}
