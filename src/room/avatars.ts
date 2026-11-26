// Avatars (2026-11-26): the user's round drawings (batchass), cleaned by tools/avatars.py into
// web/public/avatars/av000.webp... (and assets/avatars + atlas.png for Cinder, same order).
// Picked from the phone's id like the name, so a reconnect keeps it; a phone skips the avatars already taken in
// the room, so nobody shares one while there are enough.

import { AVATAR_COUNT } from './avatarCount';

export { AVATAR_COUNT };

function hash(s: string): number {
  // FNV-1a with another seed than names.ts, so the avatar doesn't follow the name
  let h = 0x811c9dc5 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** The avatar index for a phone id, the first one not in `taken` from its own starting point. */
export function avatarFor(id: string, taken: ReadonlySet<number> = new Set(), count = AVATAR_COUNT): number {
  if (count <= 0) return -1;
  const start = hash(id) % count;
  for (let k = 0; k < count; k++) {
    const a = (start + k) % count;
    if (!taken.has(a)) return a;
  }
  return start; // more phones than avatars: share
}

/** av007.webp for 7 (the file name in web/public/avatars and assets/avatars). */
export function avatarFile(i: number): string {
  return `av${String(i).padStart(3, '0')}.webp`;
}
