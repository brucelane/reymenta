// How long a Strudel patch lasts, read from its code (2026-11-06), so the Strudel pane can stop
// at the end of a full track instead of looping it. DOM-free (tested in repos/test/unit.test.ts).
// A patch has an end only when it's built from arrange() (the generated patches: one
// [cycles, "pattern"] entry per phrase); its length is the longest arrange(), in cycles. The
// tempo is the last setcpm()/setcps() with a plain number expression, else the fallback.

/** Patches shorter than this loop as before (a sketch, a groove): only full tracks stop. */
export const FULL_TRACK_SECONDS = 120;

// string literals and comments blanked (same length), so a "[48, 52]" chord or a commented-out
// arrange() can't count
function codeOnly(code: string): string {
  return code.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, (m) =>
    m.replace(/[^\n]/g, " "),
  );
}

// a number expression like 120/4 or 0.5*60, nothing else (never eval'd as code)
function num(expr: string): number | null {
  const e = expr.trim();
  if (!/^[\d.\s+\-*/()]+$/.test(e)) return null;
  const tokens = e.match(/\d*\.?\d+|[+\-*/()]/g);
  if (!tokens) return null;
  let i = 0;
  const factor = (): number => {
    const t = tokens[i++];
    if (t === "(") {
      const v = sum();
      i++; // ")"
      return v;
    }
    if (t === "-") return -factor();
    return Number(t);
  };
  const product = (): number => {
    let v = factor();
    while (tokens[i] === "*" || tokens[i] === "/") v = tokens[i++] === "*" ? v * factor() : v / factor();
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (tokens[i] === "+" || tokens[i] === "-") v = tokens[i++] === "+" ? v + product() : v - product();
    return v;
  };
  const v = sum();
  return i === tokens.length && Number.isFinite(v) ? v : null;
}

// the text between the "(" at open and its matching ")"
function inside(code: string, open: number): string {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "(" || code[i] === "[") depth++;
    else if (code[i] === ")" || code[i] === "]") {
      depth--;
      if (depth === 0) return code.slice(open + 1, i);
    }
  }
  return code.slice(open + 1);
}

/** Cycles per minute set by the code (last setcpm/setcps), or null. */
export function patchCpm(code: string): number | null {
  const c = codeOnly(code);
  let cpm: number | null = null;
  for (const m of c.matchAll(/\bset(cpm|cps)\s*\(/g)) {
    const v = num(inside(c, m.index! + m[0].length - 1));
    if (v && v > 0) cpm = m[1] === "cpm" ? v : v * 60;
  }
  return cpm;
}

/** The longest arrange() in cycles, or null when the patch has none (it loops forever). */
export function patchCycles(code: string): number | null {
  const c = codeOnly(code);
  let longest: number | null = null;
  for (const m of c.matchAll(/\barrange\s*\(/g)) {
    const args = inside(c, m.index! + m[0].length - 1);
    // top-level entries [cycles, pattern]
    let depth = 0;
    let total = 0;
    let found = false;
    for (let i = 0; i < args.length; i++) {
      const ch = args[i];
      if (ch === "[" && depth === 0) {
        const n = /^\[\s*([\d.]+(?:\s*[*/]\s*[\d.]+)*)\s*,/.exec(args.slice(i));
        const v = n ? num(n[1]) : null;
        if (v && v > 0) {
          total += v;
          found = true;
        }
      }
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
    }
    if (found && (longest === null || total > longest)) longest = total;
  }
  return longest;
}

/**
 * Where a full track ends: { cycles, seconds } when the patch is arrange()-built and lasts at
 * least FULL_TRACK_SECONDS at its tempo (fallbackCpm when the code sets none), else null.
 */
export function fullTrackEnd(code: string, fallbackCpm: number): { cycles: number; seconds: number } | null {
  const cycles = patchCycles(code);
  if (!cycles) return null;
  const cpm = patchCpm(code) ?? fallbackCpm;
  if (!(cpm > 0)) return null;
  const seconds = (cycles / cpm) * 60;
  return seconds >= FULL_TRACK_SECONDS ? { cycles, seconds } : null;
}

/**
 * The sections a patch names in its header comment (2026-11-19, the Strudel pane's scrub ticks): the BL/RM convention
 * "// Sections (bars):" then "// intro 1-8 | A 9-24 (a note) | ..." over one or more comment lines. Bars from 1;
 * 1 cycle = 1 bar, so a section starts at cycle bar - 1. Empty when the patch has no such header.
 */
export function patchSections(code: string): { name: string; bar: number }[] {
  const lines = code.split(/\r?\n/);
  // "Sections (bars):" or "Sections:", case kept (prose before it may say "sections")
  const at = lines.findIndex((l) => /^\s*\/\/.*\bSections\s*[(:]/.test(l));
  if (at < 0) return [];
  const range = /\d+\s*[-–]\s*\d+/;
  const parts: string[] = [];
  const first = lines[at].replace(/^.*\bSections\s*(\([^)]*\))?\s*:?/, "");
  if (range.test(first)) parts.push(first);
  for (let i = at + 1; i < lines.length; i++) {
    const m = /^\s*\/\/(.*)$/.exec(lines[i]);
    // a continuation line always carries a "|" (a prose line after the list may hold numbers like "3-4")
    if (!m || !m[1].includes("|")) break;
    parts.push(m[1]);
  }
  const text = parts.join(" ").replace(/–/g, "-").replace(/\([^)]*\)/g, " ");
  const out: { name: string; bar: number }[] = [];
  // "intro 1-8 [1-4]": a bracket holds the cycles when they differ from the bars ("Sections (bars, cycles in
  // brackets)", "pairs in brackets"): the scrub works in cycles, so the bracket wins
  for (const seg of text.split("|")) {
    const m = /^\s*(.+?)\s+(\d+)(?:\s*-\s*\d+)?\s*(?:\[\s*(\d+)(?:\s*-\s*\d+)?\s*\])?\s*$/.exec(seg);
    if (m && !/^\d/.test(m[1])) out.push({ name: m[1].trim(), bar: Number(m[3] ?? m[2]) });
  }
  return out.sort((a, b) => a.bar - b.bar);
}
