// .bassist(sameGap, anyGap) on a bass part (2026-11-18): the line made playable for the user's technique. He plays
// with the fingers (no plectrum), one finger per fret, and doesn't have the speed for runs of the same note, nor for
// busy slap lines. In each cycle (bar), in time order:
// - a note of the same pitch as the last note kept, sooner than `sameGap` cycles after it, is dropped (16th repeats
//   become 8ths; the kept note rings on to the next 8th);
// - with `anyGap` > 0 (the slap songs), any note sooner than `anyGap` after the last kept is dropped, except an octave
//   up or down (the thumb-and-pop octave stays).
// - every note is folded by octaves into his range, E1 (28, the open low E) to D3 (50, G string 7th fret).
// Pure JavaScript (no import): installed with the Strudel core's classes by the WebApp (strudelEngine), the patch
// checker (test/tools/check-strudel-patch.mjs) and the tab tool (scripts/patch-tab.mjs), so all three play the same
// notes. Times are cycles: an 8th note is 0.5 / (quarter beats per cycle), 1/8 in 4/4.
const EPS = 1e-6;
const LOW = 28, HIGH = 50; // E1 .. D3

/** @param {{ Pattern: any, Hap: any, TimeSpan: any, noteToMidi: (n: string) => number }} core */
export function installBassist(core) {
  const { Pattern, Hap, TimeSpan, noteToMidi } = core;
  if (Pattern.prototype.bassist) return;
  const pitch = (v) => {
    const n = v && typeof v === "object" ? v.note : v;
    if (typeof n === "number") return n;
    try {
      return noteToMidi(String(n));
    } catch {
      return NaN;
    }
  };
  /** the haps kept in cycle c, with their new end (begin/end as numbers) */
  const cycleCache = new WeakMap();
  function keptIn(pat, c, sameGap, anyGap) {
    let byCycle = cycleCache.get(pat);
    if (!byCycle) cycleCache.set(pat, (byCycle = new Map()));
    const key = `${c}|${sameGap}|${anyGap}`;
    if (byCycle.has(key)) return byCycle.get(key);
    const haps = pat
      .queryArc(c, c + 1)
      .filter((h) => h.whole && h.hasOnset())
      .sort((a, b) => a.whole.begin.valueOf() - b.whole.begin.valueOf());
    const kept = [];
    for (const h of haps) {
      const b = h.whole.begin.valueOf();
      let k = pitch(h.value);
      if (Number.isFinite(k)) {
        while (k > HIGH) k -= 12;
        while (k < LOW) k += 12;
      }
      const last = kept[kept.length - 1];
      if (last) {
        const gap = b - last.b;
        const octave = Math.abs(k - last.k) === 12;
        if ((k === last.k && gap < sameGap - EPS) || (anyGap > 0 && gap < anyGap - EPS && !octave)) {
          // the dropped note's time: the kept one rings on, at most to sameGap (or anyGap) after its start
          last.e = Math.max(last.e, Math.min(h.whole.end.valueOf(), last.b + Math.max(sameGap, anyGap)));
          continue;
        }
      }
      kept.push({ h, b, e: h.whole.end.valueOf(), k });
    }
    byCycle.set(key, kept);
    return kept;
  }
  Pattern.prototype.bassist = function (sameGap = 0.125, anyGap = 0) {
    const pat = this;
    return new Pattern((state) => {
      const qb = state.span.begin.valueOf(), qe = state.span.end.valueOf();
      const out = [];
      // notes start inside a cycle; a long note can reach into the queried span from an earlier cycle
      for (let c = Math.floor(qb) - 1; c < Math.ceil(qe); c++) {
        for (const { h, b, e, k } of keptIn(pat, c, sameGap, anyGap)) {
          if (e <= qb + EPS || b >= qe - EPS) continue;
          const whole = new TimeSpan(h.whole.begin, h.whole.begin.add(e - b));
          const part = new TimeSpan(whole.begin.max(state.span.begin), whole.end.min(state.span.end));
          const v = h.value && typeof h.value === "object" && Number.isFinite(k) && pitch(h.value) !== k ? { ...h.value, note: k } : h.value;
          out.push(new Hap(whole, part, v, h.context));
        }
      }
      return out;
    });
  };
}
