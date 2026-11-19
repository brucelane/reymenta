// The public library (studies/reymenta-workshop.md "Public tracks and artist pages"): index.json + tabs/<folder>.tab.json
// + patches/<folder>.strudel.js (step 4) + shaders/<folder>.glsl (an ubershader, for a later step: carried, not used)
// + artists/<id>.png, from the audience server on the network (GET /api/library/...), else
// https://assets.batchass.fr/library/, else nothing (offline: only the user's own library).
// The index is untrusted: validated here. validateIndex is pure; loadCatalogue fetches.
import { validateLinks, validateSetlist, validateTrack, type Link, type Setlist, type Track } from './library';
import { validatePatch } from './patch';
import { validateTab, type WTab } from './tabEdit';

export interface I18nText { fr: string; en: string }
export interface Artist {
  id: string;
  name: string;
  tagline: I18nText;
  bio: I18nText;
  members: { name: string; role: I18nText }[];
  links: Link[];
  /** "artists/<id>.png", relative to the library's base */
  logo?: string;
}
export interface About { title: string; text: I18nText; links: Link[]; logo?: string }
/** A public track: track.json fields, its artist, and where its tab, patch and shader are ("tabs/<folder>.tab.json",
 * "patches/<folder>.strudel.js", "shaders/<folder>.glsl"). */
export type PublicTrack = Track & { tabPath?: string; patchPath?: string; shaderPath?: string };
export interface Catalogue {
  /** where the files are, ending with "/" ("" for the bundled artists only) */
  base: string;
  artists: Artist[];
  about?: About;
  setlists: Setlist[];
  tracks: PublicTrack[];
}

export const PUBLIC_LIBRARY = 'https://assets.batchass.fr/library/';

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const text = (v: unknown, max: number): I18nText => ({
  fr: obj(v) && str(v.fr, max) ? v.fr : '',
  en: obj(v) && str(v.en, max) ? v.en : '',
});
/** a file next to index.json: "artists/x.png", "tabs/x.tab.json" (segments of [\w.-], no "..") */
export const isLibraryPath = (p: unknown): p is string =>
  typeof p === 'string' && p.length <= 200 && p.split('/').every((s) => /^[\w.-]+$/.test(s) && s !== '..' && s !== '.');

export function validateArtists(raw: unknown): { artists: Artist[]; about?: About } {
  const r = obj(raw) ? raw : {};
  const artists: Artist[] = [];
  for (const a of Array.isArray(r.artists) ? r.artists.slice(0, 50) : []) {
    if (!obj(a) || !str(a.id, 40) || !/^[a-z0-9-]+$/.test(a.id) || !str(a.name, 120)) continue;
    artists.push({
      id: a.id, name: a.name, tagline: text(a.tagline, 300), bio: text(a.bio, 8000),
      members: (Array.isArray(a.members) ? a.members.slice(0, 20) : [])
        .filter((m): m is Record<string, unknown> => obj(m) && str(m.name, 120))
        .map((m) => ({ name: m.name as string, role: text(m.role, 200) })),
      links: validateLinks(a.links) ?? [],
      ...(isLibraryPath(a.logo) ? { logo: a.logo } : {}),
    });
  }
  const ab = r.about;
  const about = obj(ab) && str(ab.title, 120)
    ? { title: ab.title, text: text(ab.text, 8000), links: validateLinks(ab.links) ?? [], ...(isLibraryPath(ab.logo) ? { logo: ab.logo } : {}) }
    : undefined;
  return { artists, ...(about ? { about } : {}) };
}

/** index.json -> a Catalogue (invalid entries dropped), or undefined when it isn't the library's index. */
export function validateIndex(raw: unknown, base: string): Catalogue | undefined {
  if (!obj(raw) || raw.app !== 'videodromm-library' || raw.version !== 1) return undefined;
  const { artists, about } = validateArtists(raw);
  const setlists: Setlist[] = [];
  for (const s of Array.isArray(raw.setlists) ? raw.setlists.slice(0, 500) : []) {
    const v = validateSetlist(s);
    if (typeof v !== 'string') setlists.push(v);
  }
  const tracks: PublicTrack[] = [];
  for (const t of Array.isArray(raw.tracks) ? raw.tracks.slice(0, 5000) : []) {
    const v = validateTrack(t);
    if (typeof v === 'string' || tracks.some((x) => x.folder === v.folder)) continue;
    const path = (k: string, re: RegExp) => (obj(t) && isLibraryPath(t[k]) && re.test(t[k] as string) ? (t[k] as string) : undefined);
    const tabPath = path('tab', /^tabs\/[\w .-]+\.tab\.json$/);
    const patchPath = path('patch', /^patches\/[\w .-]+\.strudel\.js$/);
    const shaderPath = path('shader', /^shaders\/[\w .-]+\.glsl$/);
    // validateTrack kept "patch"/"shader" as plain extra fields: they are paths here, held apart
    const { patch: _p, shader: _s, ...clean } = v;
    void _p; void _s;
    tracks.push({ ...clean, ...(tabPath ? { tabPath } : {}), ...(patchPath ? { patchPath } : {}), ...(shaderPath ? { shaderPath } : {}) });
  }
  return { base, artists, ...(about ? { about } : {}), setlists, tracks };
}

/** The places to try, in order: the audience server on the network, then the public site. */
export function librarySources(o: { nativeServer?: string; pageHost?: string; pageIsLan?: boolean }): string[] {
  const out: string[] = [];
  const typed = (o.nativeServer ?? '').replace(/^(wss?|https?):\/\//, '').replace(/\/.*$/, '');
  if (typed) out.push(`http://${typed.includes(':') ? typed : `${typed}:5191`}/api/library/`);
  else if (o.pageIsLan) out.push('./api/library/'); // the dev server proxies it to the audience server
  out.push(PUBLIC_LIBRARY);
  return out;
}

async function fetchJson(url: string, ms: number, maxBytes: number): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, cache: 'no-cache' });
    if (!r.ok) throw new Error(`${r.status}`);
    const body = await r.text();
    if (body.length > maxBytes) throw new Error('too large');
    return JSON.parse(body);
  } finally {
    clearTimeout(timer);
  }
}

/** The first source whose index.json answers. */
export async function loadCatalogue(sources: string[]): Promise<Catalogue | undefined> {
  for (const base of sources) {
    try {
      const c = validateIndex(await fetchJson(`${base}index.json`, 4000, 8 * 1024 * 1024), base);
      if (c) return c;
    } catch { /* next source */ }
  }
  return undefined;
}

/** A public track's tab (validated), or undefined. */
export async function loadPublicTab(c: Catalogue, t: PublicTrack): Promise<WTab | undefined> {
  if (!t.tabPath || !c.base) return undefined;
  try {
    const v = validateTab(await fetchJson(`${c.base}${t.tabPath}`, 8000, 4 * 1024 * 1024));
    return typeof v === 'string' ? undefined : v;
  } catch {
    return undefined;
  }
}

/** A public track's patch (Strudel code, checked by validatePatch), or undefined. Not run: the user presses Play. */
export async function loadPublicPatch(c: Catalogue, t: PublicTrack): Promise<string | undefined> {
  if (!t.patchPath || !c.base) return undefined;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`${c.base}${t.patchPath}`, { signal: ctl.signal, cache: 'no-cache' });
    if (!r.ok) return undefined;
    const v = validatePatch(await r.text());
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** The index entry back as index.json writes it (the Workshop keeps the last index for offline). */
export function toIndexTrack(t: PublicTrack): Record<string, unknown> {
  const { tabPath, patchPath, shaderPath, ...r } = t;
  return { ...r, ...(tabPath ? { tab: tabPath } : {}), ...(patchPath ? { patch: patchPath } : {}), ...(shaderPath ? { shader: shaderPath } : {}) };
}

/** A public track as it goes into my library (track.json fields, tab.json name; the patch goes in lib.patches). */
export function toLibraryTrack(t: PublicTrack, tab?: WTab): Track {
  const { tabPath: _path, patchPath: _patch, shaderPath: _shader, ...rest } = t;
  void _path; void _patch; void _shader;
  return { ...rest, ...(tab ? { tabFile: `${t.folder}.tab.json`, tab: { tuning: tab.tuning } } : {}) };
}
