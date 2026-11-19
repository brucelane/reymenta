// Where the Workshop keeps the library on the phone: IndexedDB (no 5 MB limit), else localStorage. One record, the
// whole library, written a moment after each change; also the last public index, so it works offline.
import { emptyLibrary, validateLibrary, type Library } from './library';

const DB = 'reymenta-workshop';
const STORE = 'kv';
const LS = 'reymenta:workshop:';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let db: Promise<IDBDatabase> | undefined;
const getDb = () => (db ??= openDb());

async function idbGet(key: string): Promise<unknown> {
  const d = await getDb();
  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE, 'readonly').objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const d = await getDb();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** A stored value (as JSON text): IndexedDB first, localStorage second. */
export async function loadText(key: string): Promise<string | undefined> {
  try {
    const v = await idbGet(key);
    if (typeof v === 'string') return v;
  } catch { /* no IndexedDB: localStorage */ }
  try { return localStorage.getItem(LS + key) ?? undefined; } catch { return undefined; }
}

/** Stores a value; false when neither place took it (storage full or blocked). */
export async function saveText(key: string, text: string): Promise<boolean> {
  try {
    await idbSet(key, text);
    try { localStorage.removeItem(LS + key); } catch { /* fine */ }
    return true;
  } catch { /* fall back */ }
  try { localStorage.setItem(LS + key, text); return true; } catch { return false; }
}

export async function loadLibrary(): Promise<Library> {
  const text = await loadText('library');
  if (!text) return emptyLibrary();
  try {
    const v = validateLibrary(JSON.parse(text));
    return typeof v === 'string' ? emptyLibrary() : v.library;
  } catch {
    return emptyLibrary();
  }
}

export const saveLibrary = (lib: Library) =>
  saveText('library', JSON.stringify({
    app: lib.app, version: lib.version, setlists: lib.setlists, tracks: lib.tracks, tabs: lib.tabs,
    patches: lib.patches, drums: lib.drums, hydra: lib.hydra, sketches: lib.sketches, originals: lib.originals,
  }));

/** Saves a file to the device: an <a download> with a Blob (browsers; inside the Android app's WebView it may do nothing). */
export function download(name: string, text: string | Uint8Array, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
