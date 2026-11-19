// GET /api/library/<path>: the public library (index.json, tabs/<folder>.tab.json, artists/<id>.png,
// patches/<folder>.strudel.js and shaders/<folder>.glsl, both as text/plain: never served as a script) on the LAN, so the
// Workshop on a phone at the show finds it without the internet (studies/reymenta-workshop.md step 3). Read only,
// files from assets/public/library (LIBRARY_DIR), any origin (the Android app's is http://localhost).
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve, sep } from 'node:path';

const TEXT = 'text/plain; charset=utf-8';
const TYPES: Record<string, string> = { '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.strudel.js': TEXT, '.glsl': TEXT };
const MAX_BYTES = 16 * 1024 * 1024;

/** The file under `root` for a request path after /api/library/, or undefined when the path isn't allowed:
 *  segments of [\w.-] only, no "." or "..", a .json, .png, .strudel.js or .glsl file. */
export function libraryFile(root: string, path: string): { file: string; type: string } | undefined {
  let p: string;
  try { p = decodeURIComponent(path); } catch { return undefined; }
  if (!p || p.length > 200) return undefined;
  const parts = p.split('/');
  if (!parts.every((s) => /^[\w.-]+$/.test(s) && s !== '.' && s !== '..')) return undefined;
  const ext = /(\.strudel\.js|\.[a-z]+)$/.exec(parts[parts.length - 1])?.[0] ?? '';
  const type = TYPES[ext];
  if (!type) return undefined;
  const base = resolve(root);
  const file = resolve(base, ...parts);
  if (!file.startsWith(base + sep)) return undefined;
  return { file, type };
}

/** Answers /api/library/... requests; false for any other URL. */
export function handleLibrary(root: string, req: IncomingMessage, res: ServerResponse): boolean {
  const m = /^\/api\/library\/([^?#]*)/.exec(req.url ?? '');
  if (!m) return false;
  const cors = { 'access-control-allow-origin': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET' }).end(); return true; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, cors).end(); return true; }
  const f = libraryFile(root, m[1]);
  if (!f) { res.writeHead(400, cors).end(); return true; }
  void (async () => {
    try {
      const s = await stat(f.file);
      if (!s.isFile() || s.size > MAX_BYTES) throw new Error('not a file');
      const body = await readFile(f.file);
      res.writeHead(200, { ...cors, 'content-type': f.type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404, cors).end();
    }
  })();
  return true;
}

/** assets/public/library next to this repo (repos/assets), unless LIBRARY_DIR says otherwise. */
export const defaultLibraryDir = (here: string) => process.env.LIBRARY_DIR ?? join(here, '..', '..', '..', 'assets', 'public', 'library');
