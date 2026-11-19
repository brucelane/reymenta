// Grooves from strudel-flow (studies/reymenta-workshop.md step 6): the user's fork of xyflow/strudel-flow
// (repos/strudel-flow, deployed at app.videodromm.com by the videodromm-swa repo) builds grooves from nodes and shows
// the Strudel code it generates (its pattern panel: `setcpm(<bpm>/<beats per cycle>)` then one `$: ...` per chain,
// paused chains commented out). Its generator needs every node's definition (React registry), so it isn't brought
// here: the user copies that code (or saves it as a file) and the Workshop turns it into one expression added to a
// track's patch. A strudel-flow patch JSON (its "Export") is recognised and described, not regenerated.
// Pure functions, no DOM.
import { MAX_PATCH_BYTES } from './patch';

export const DEFAULT_FLOW_URL = 'https://app.videodromm.com/';

/** A strudel-flow address the user set: http(s) only; undefined when it isn't one. */
export function validFlowUrl(raw: string): string | undefined {
  try {
    const u = new URL(raw.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

export interface Groove {
  /** setcpm's argument as written ("120/4"), if any */
  cpm?: string;
  /** the playing chains' expressions (paused, commented ones left out) */
  parts: string[];
}

/** strudel-flow's code (or any `$:` code) -> its chains; an error text when there's nothing to play. */
export function parseGroove(raw: string): Groove | { error: string } {
  if (raw.length > MAX_PATCH_BYTES) return { error: 'too large' };
  if (/^\s*[{[]/.test(raw)) return { error: 'JSON, not code' };
  const lines = raw.replace(/\r\n/g, '\n').split('\n');
  let cpm: string | undefined;
  const parts: string[] = [];
  const loose: string[] = [];
  let cur: string[] | null = null;
  const close = () => { if (cur) { const p = cur.join('\n').trim(); if (p) parts.push(p); } cur = null; };
  for (const line of lines) {
    const t = line.trim();
    const c = /^setcpm\s*\(\s*(.+?)\s*\)\s*;?\s*$/.exec(t);
    if (c) { cpm = c[1]; continue; }
    if (/^\/\//.test(t)) { if (/^\/\/\s*\$:/.test(t)) close(); continue; }
    const d = /^\$:\s*(.*)$/.exec(t);
    if (d) { close(); cur = [d[1]]; continue; }
    if (cur) (cur as string[]).push(line);
    else if (t) loose.push(line);
  }
  close();
  // code without `$:`: the rest is one expression (a plain pattern pasted from elsewhere)
  if (!parts.length && loose.length) parts.push(loose.join('\n').trim().replace(/;\s*$/, ''));
  if (!parts.length) return { error: 'no pattern' };
  return { cpm, parts: parts.map((p) => p.replace(/;\s*$/, '')) };
}

/** The chains as one expression: the chain, or stack(a, b...). */
export const grooveExpression = (g: Groove): string =>
  g.parts.length === 1 ? g.parts[0] : `stack(\n${g.parts.map((p) => `  ${p.replace(/\n/g, '\n  ')}`).join(',\n')}\n)`;

/** strudel-flow's own code as a patch on its own (a track with no patch yet). */
export const grooveAsPatch = (g: Groove, title: string): string =>
  `// ${title.replace(/[\r\n]+/g, ' ').slice(0, 120)} (groove from strudel-flow)\n${g.cpm ? `setcpm(${g.cpm})\n` : ''}\n${grooveExpression(g)}\n`;

export interface FlowPatchInfo { name: string; cpm: string; bpc: string; nodes: number }

/** A strudel-flow patch JSON (ProjectState: nodes, edges, cpm, bpc...) described; undefined when it isn't one. */
export function flowPatchInfo(text: string): FlowPatchInfo | undefined {
  let v: unknown;
  try { v = JSON.parse(text); } catch { return undefined; }
  if (!v || typeof v !== 'object') return undefined;
  const s = v as Record<string, unknown>;
  if (!Array.isArray(s.nodes) || !Array.isArray(s.edges) || !Number.isFinite(Number(s.cpm))) return undefined;
  return {
    name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 120) : 'Untitled patch',
    cpm: String(s.cpm), bpc: String(s.bpc ?? '4'), nodes: s.nodes.length,
  };
}
