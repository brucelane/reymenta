// Hydra on a phone (hydraTouch.ts): the number under the cursor and its ± step, the extra keys, and the Live runner
// (debounce, one run at a time, rollback to the last working code, nothing before an explicit Run).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compile } from '../web/src/workshop/hydraEval';
import { EXTRA_KEYS, LiveRunner, nudge, numberAt, stepNumber, type LiveDeps } from '../web/src/workshop/hydraTouch';

test('numberAt: the literal under or touching the cursor', () => {
  const l = 'osc(60, 0.1, 1.5).out(o0)';
  assert.deepEqual(numberAt(l, 4), { from: 4, to: 6, text: '60', value: 60, decimals: 0 }); // before 6
  assert.equal(numberAt(l, 5)?.text, '60');
  assert.equal(numberAt(l, 6)?.text, '60'); // just after: the number on the left
  assert.equal(numberAt(l, 9)?.text, '0.1');
  assert.equal(numberAt(l, 9)?.decimals, 1);
  assert.equal(numberAt(l, 14)?.text, '1.5');
  assert.equal(numberAt(l, 2), undefined); // in `osc`
  assert.equal(numberAt(l, 24), undefined); // `o0` is a name
  assert.equal(numberAt('src(s1)', 6), undefined);
  assert.equal(numberAt('x2 = 3', 2), undefined);
  assert.equal(numberAt('1e3', 1), undefined);
  assert.equal(numberAt('', 0), undefined);
  assert.equal(numberAt('.5', 0)?.text, '.5');
  assert.equal(numberAt('a.fft[0]', 7)?.text, '0');
});

test('numberAt: a sign is part of the number, a subtraction is not', () => {
  assert.equal(numberAt('rotate(-0.5)', 9)?.text, '-0.5');
  assert.equal(numberAt('x = -1', 6)?.text, '-1');
  assert.equal(numberAt('f(1, - 2)', 8)?.text, '2'); // `- 2` with a space: the minus is kept only when glued
  assert.equal(numberAt('time-1', 6)?.text, '1');
  assert.equal(numberAt('a - 1', 5)?.text, '1');
  assert.equal(numberAt('f()-1', 5)?.text, '1');
});

test('stepNumber: by the last decimal place, same writing', () => {
  const s = (text: string, dir: 1 | -1) => stepNumber(numberAt(text, text.length)!, dir);
  assert.equal(s('0.1', 1), '0.2');
  assert.equal(s('0.3', -1), '0.2'); // no 0.19999999
  assert.equal(s('60', 1), '61');
  assert.equal(s('0', -1), '-1');
  assert.equal(s('-1', 1), '0');
  assert.equal(s('-0.1', 1), '0.0');
  assert.equal(s('1.50', 1), '1.51');
  assert.equal(s('.5', 1), '.6');
  assert.equal(s('1.', 1), '2.');
  assert.equal(s('0.99', 1), '1.00');
});

test('nudge: the change to apply in the line', () => {
  assert.deepEqual(nudge('osc(60, 0.1)', 10, 1), { from: 8, to: 11, insert: '0.2' });
  assert.deepEqual(nudge('osc(60, 0.1)', 4, -1), { from: 4, to: 6, insert: '59' });
  assert.equal(nudge('osc()', 3, 1), undefined);
});

test('extra keys: the approved set', () => {
  assert.deepEqual(EXTRA_KEYS.slice(0, 10), ['(', ')', '.', ',', '=', '=>', '"', "'", '[', ']']);
  assert.equal(EXTRA_KEYS.length, 20);
});

/** a fake clock and a fake Hydra: `run` throws on code containing "boom" */
function harness(opts: { slow?: boolean } = {}) {
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let ids = 0;
  const log: string[] = [];
  let release: (() => void) | undefined;
  const deps: LiveDeps = {
    parse: (code) => { compile(code); },
    run: async (code) => {
      log.push(`run ${code}`);
      if (opts.slow) await new Promise<void>((r) => { release = r; });
      if (code.includes('boom')) throw new Error('boom');
    },
    onOk: (code) => log.push(`ok ${code}`),
    onError: (e, code, kept) => log.push(`error ${code} ${(e as Error).name} kept=${kept}`),
    setTimer: (fn, ms) => { const id = ++ids; timers.push({ at: now + ms, fn, id }); return id; },
    clearTimer: (id) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  };
  const advance = async (ms: number) => {
    now += ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > now) break;
      timers.shift();
      t.fn();
    }
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };
  return { live: new LiveRunner(deps), log, advance, release: () => release?.() };
}

test('Live: nothing before an explicit Run, then debounced', async () => {
  const h = harness();
  h.live.setEnabled(true);
  assert.equal(h.live.enabled, false);
  h.live.edit('a');
  await h.advance(1000);
  assert.deepEqual(h.log, []); // a file's code doesn't run by itself
  h.live.arm('a0');
  assert.equal(h.live.enabled, true);
  h.live.edit('a1');
  await h.advance(300);
  h.live.edit('a12');
  await h.advance(300);
  assert.deepEqual(h.log, []); // still typing
  await h.advance(200);
  assert.deepEqual(h.log, ['run a12', 'ok a12']);
  assert.equal(h.live.lastGood, 'a12');
  h.live.setEnabled(false);
  h.live.edit('a123');
  await h.advance(1000);
  assert.equal(h.log.length, 2);
});

test('Live: a typo keeps the last working version, a runtime error runs it again', async () => {
  const h = harness();
  h.live.arm('good()');
  h.live.setEnabled(true);
  h.live.edit('osc(');
  await h.advance(500);
  assert.deepEqual(h.log, ['error osc( SyntaxError kept=true']); // nothing ran
  h.log.length = 0;
  h.live.edit('boom()');
  await h.advance(500);
  assert.deepEqual(h.log, ['run boom()', 'run good()', 'error boom() Error kept=true']);
  h.log.length = 0;
  h.live.edit('boom()'); // the same code again: not re-run
  await h.advance(500);
  assert.deepEqual(h.log, []);
});

test('Live: without a working version yet, the error is reported as not kept', async () => {
  const h = harness();
  h.live.arm(); // a Block was run, not the whole sketch
  h.live.setEnabled(true);
  h.live.edit('boom()');
  await h.advance(500);
  assert.deepEqual(h.log, ['run boom()', 'error boom() Error kept=false']);
});

test('Live: one run at a time, the latest waiting code wins', async () => {
  const h = harness({ slow: true });
  h.live.arm('x');
  h.live.setEnabled(true);
  h.live.edit('a', 0);
  await h.advance(0);
  h.live.edit('b', 0);
  await h.advance(0);
  h.live.edit('c', 0);
  await h.advance(0);
  assert.deepEqual(h.log, ['run a']);
  h.release();
  await h.advance(0);
  assert.deepEqual(h.log, ['run a', 'ok a', 'run c']); // b dropped
  h.release();
  await h.advance(0);
  assert.deepEqual(h.log, ['run a', 'ok a', 'run c', 'ok c']);
});

test('Live: new code from a file disarms it', async () => {
  const h = harness();
  h.live.arm('x');
  h.live.setEnabled(true);
  h.live.edit('y');
  h.live.disarm();
  await h.advance(1000);
  assert.deepEqual(h.log, []);
  assert.equal(h.live.enabled, false);
  assert.equal(h.live.lastGood, undefined);
});
