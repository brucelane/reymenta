// Messages between the phones and the audience server (JSON over a websocket today, Azure Web PubSub groups
// later: the same shapes). Short keys: every message counts against the Web PubSub quota (2 KB units).

/** Phone -> server. */
export type PhoneMessage =
  /** first message, and again after a reconnect: `id` is kept in the phone's storage */
  | { t: 'hello'; id: string; lang: 'fr' | 'en'; hue?: number }
  /** every 5 s while nothing else is sent */
  | { t: 'hb' }
  /** sensors and touch, sent at most 10 times a second and only when something changed.
   *  tx, ty: tilt -1..1 (left/right, front/back); sh: shake energy 0..1; to: finger down 0/1;
   *  px, py: finger position 0..1 on the phone screen (when to = 1) */
  | { t: 'in'; tx?: number; ty?: number; sh?: number; to?: 0 | 1; px?: number; py?: number }
  /** an emoji from the fixed list (index) */
  | { t: 'emo'; e: number };

/** Server -> one phone. */
export type ServerMessage =
  /** answer to hello: the phone's slot, place in the grid (0..1) and random name */
  | { t: 'welcome'; slot: number; x: number; y: number; name: { fr: string; en: string }; hue: number }
  /** the room changed size, or the phone's place moved */
  | { t: 'place'; slot: number; x: number; y: number; count: number }
  /** the show's mode (what the phone screen shows), e.g. "circles", "off" */
  | { t: 'mode'; mode: string }
  /** the room is full (cap reached) */
  | { t: 'full' }
  /** the server doesn't know this phone (it timed out, or the server restarted): say hello again */
  | { t: 'rejoin' }
  /** the emoji row shown or hidden (2026-11-17): on when the track Cinder plays opens it, or the operator does */
  | { t: 'emojis'; on: boolean };

/** The fixed emoji list: the phone sends an index, never text. */
export const EMOJIS = ['🔥', '😍', '🤯', '👏', '🚀', '🌀', '💜', '🎛️'] as const;

/** Rendered participants (more can join; only these get a place on the projection). */
export const MAX_PLACES = 64;

/** Parses and validates a phone message; undefined when it isn't one (anything from a phone is untrusted). */
export function parsePhoneMessage(raw: string): PhoneMessage | undefined {
  if (raw.length > 512) return undefined;
  let m: unknown;
  try { m = JSON.parse(raw); } catch { return undefined; }
  if (!m || typeof m !== 'object') return undefined;
  const o = m as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number): number | undefined =>
    typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined;
  switch (o.t) {
    case 'hello': {
      if (typeof o.id !== 'string' || !/^[A-Za-z0-9_-]{8,40}$/.test(o.id)) return undefined;
      const lang = o.lang === 'fr' ? 'fr' : 'en';
      return { t: 'hello', id: o.id, lang, hue: num(o.hue, 0, 360) };
    }
    case 'hb':
      return { t: 'hb' };
    case 'in': {
      const msg: PhoneMessage = { t: 'in' };
      const tx = num(o.tx, -1, 1); if (tx !== undefined) msg.tx = tx;
      const ty = num(o.ty, -1, 1); if (ty !== undefined) msg.ty = ty;
      const sh = num(o.sh, 0, 1); if (sh !== undefined) msg.sh = sh;
      if (o.to === 0 || o.to === 1) msg.to = o.to;
      const px = num(o.px, 0, 1); if (px !== undefined) msg.px = px;
      const py = num(o.py, 0, 1); if (py !== undefined) msg.py = py;
      return msg;
    }
    case 'emo': {
      const e = o.e;
      return typeof e === 'number' && Number.isInteger(e) && e >= 0 && e < EMOJIS.length ? { t: 'emo', e } : undefined;
    }
    default:
      return undefined;
  }
}
