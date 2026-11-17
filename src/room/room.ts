// The room: who's there, where they sit, what they do, and the room-level values sent to Cinder as the
// iAud0..iAud31 uniforms (indexes 260..291). Pure logic, no I/O: the server (today) and the browser
// /screen (the demo, later) both host it. Times are milliseconds from the caller (Date.now() or a test clock).

import { layout, type Place } from './layout';
import { nameFor } from './names';
import { EMOJIS, MAX_PLACES, type PhoneMessage, type ServerMessage } from './protocol';

/** Cinder uniform index of iAud0. */
export const IAUD0 = 260;
export const IAUD_COUNT = 32;

/** What each iAud uniform carries (all 0..1). Keep in step with the shaders that read them. */
export const AUD = {
  count: 0,      // participants / 64
  tiltX: 1,      // average left/right tilt, 0.5 = flat (also 0.5 with nobody)
  tiltY: 2,      // average front/back tilt, 0.5 = flat
  shake: 3,      // average shake energy
  touch: 4,      // fraction of phones with a finger down
  fire: 5,       // the 🔥 meter: 🔥 sent in the last 10 s, relative to the room's size
  emoji: 6,      // all emoji activity in the last 3 s
  fingerX: 7,    // average finger position of the phones touching (0.5 when none)
  fingerY: 8,
  each: 9,       // 9..15 (2026-11-17): EMOJIS[1..7] (😍 🤯 👏 🚀 🌀 💜 🎛️) each on its own: every tap adds
                 // 1/EMOJI_SLOTS, fading with EMOJI_FADE_MS; the shader shows that many of it (audience_emoji.glsl).
                 // 🔥 keeps iAud5. Absolute (not per room size): one tap = one emoji on screen.
  look: 16,      // 16..31: the first PER_PHONE_LOOK phones' own look, x then y (2026-11-16): finger while touching,
                 // else tilt; 0.5 = straight ahead. Slot order = join order = the eyes' order in the shaders.
} as const;

/** How many phones get their own look in iAud16..31 (2 values each). */
export const PER_PHONE_LOOK = 8;

/** A phone silent for this long (no message, no heartbeat) leaves the room. */
export const TIMEOUT_MS = 15000;
/** One emoji per phone every this many ms. */
export const EMOJI_INTERVAL_MS = 1500;
/** Emojis of one kind the shader can show at once (iAud9..15 = count / EMOJI_SLOTS). */
export const EMOJI_SLOTS = 12;
/** A tap's emoji fades with this time constant: about 7 s until it's gone. */
export const EMOJI_FADE_MS = 2500;

export interface Participant {
  id: string;
  lang: 'fr' | 'en';
  name: { fr: string; en: string };
  hue: number;
  joined: number;
  lastSeen: number;
  lastEmoji: number;
  tx: number; ty: number; sh: number; to: 0 | 1; px: number; py: number;
}

export interface Outgoing { id: string; msg: ServerMessage }

export class Room {
  private people: Participant[] = []; // in slot order (join order)
  private emojis: Array<{ e: number; at: number }> = [];
  private rejoinAsked = new Map<string, number>();
  mode = 'circles';

  get count(): number { return this.people.length; }

  participants(): readonly Participant[] { return this.people; }

  /** Places in slot order (the same order as participants()). */
  places(): Place[] { return layout(this.people.length); }

  /** Handles a phone message; returns the messages to send (to that phone, or to everyone on a layout change). */
  receive(id: string, msg: PhoneMessage, now: number): Outgoing[] {
    if (msg.t === 'hello') return this.join(id, msg.lang, msg.hue, now);
    const p = this.people.find((q) => q.id === id);
    if (!p) {
      // a phone the room dropped (asleep for 15 s, or a server restart) keeps talking: ask it to say hello again,
      // at most every 3 s
      if (now - (this.rejoinAsked.get(id) ?? 0) < 3000) return [];
      this.rejoinAsked.set(id, now);
      return [{ id, msg: { t: 'rejoin' } }];
    }
    this.rejoinAsked.delete(id);
    p.lastSeen = now;
    if (msg.t === 'in') {
      if (msg.tx !== undefined) p.tx = msg.tx;
      if (msg.ty !== undefined) p.ty = msg.ty;
      if (msg.sh !== undefined) p.sh = msg.sh;
      if (msg.to !== undefined) p.to = msg.to;
      if (msg.px !== undefined) p.px = msg.px;
      if (msg.py !== undefined) p.py = msg.py;
    } else if (msg.t === 'emo') {
      if (now - p.lastEmoji >= EMOJI_INTERVAL_MS) {
        p.lastEmoji = now;
        this.emojis.push({ e: msg.e, at: now });
      }
    }
    return [];
  }

  private join(id: string, lang: 'fr' | 'en', hue: number | undefined, now: number): Outgoing[] {
    let p = this.people.find((q) => q.id === id);
    let layoutChanged = false;
    if (!p) {
      if (this.people.length >= MAX_PLACES) return [{ id, msg: { t: 'full' } }];
      const n = nameFor(id);
      p = {
        id, lang, name: { fr: n.fr, en: n.en }, hue: hue ?? n.hue, joined: now, lastSeen: now, lastEmoji: 0,
        tx: 0, ty: 0, sh: 0, to: 0, px: 0.5, py: 0.5,
      };
      this.people.push(p);
      layoutChanged = true;
    } else {
      p.lang = lang;
      p.lastSeen = now;
      if (hue !== undefined) p.hue = hue;
    }
    const slot = this.people.indexOf(p);
    const place = this.places()[slot];
    const out: Outgoing[] = [
      { id, msg: { t: 'welcome', slot, x: place.x, y: place.y, name: p.name, hue: p.hue } },
      { id, msg: { t: 'mode', mode: this.mode } },
    ];
    if (layoutChanged) out.push(...this.placeUpdates(id));
    return out;
  }

  /** Removes a phone (its socket closed). */
  leave(id: string): Outgoing[] {
    const i = this.people.findIndex((q) => q.id === id);
    if (i < 0) return [];
    this.people.splice(i, 1);
    return this.placeUpdates();
  }

  /** Drops the phones silent for TIMEOUT_MS and old emojis. Returns the place updates if anyone left. */
  prune(now: number): Outgoing[] {
    this.emojis = this.emojis.filter((x) => now - x.at < 10000);
    const before = this.people.length;
    this.people = this.people.filter((p) => now - p.lastSeen < TIMEOUT_MS);
    return this.people.length === before ? [] : this.placeUpdates();
  }

  /** Changes the mode and tells every phone. */
  setMode(mode: string): Outgoing[] {
    this.mode = mode;
    return this.people.map((p) => ({ id: p.id, msg: { t: 'mode', mode } as ServerMessage }));
  }

  private placeUpdates(except?: string): Outgoing[] {
    const places = this.places();
    const count = this.people.length;
    return this.people
      .map((p, slot) => ({ p, slot }))
      .filter(({ p }) => p.id !== except)
      .map(({ p, slot }) => ({ id: p.id, msg: { t: 'place', slot, x: places[slot].x, y: places[slot].y, count } as ServerMessage }));
  }

  /** The room-level values, IAUD_COUNT of them, each 0..1 (see AUD). */
  aggregates(now: number): number[] {
    const v = new Array<number>(IAUD_COUNT).fill(0);
    const n = this.people.length;
    v[AUD.count] = n / MAX_PLACES;
    const avg = (f: (p: Participant) => number, list = this.people) =>
      list.length ? list.reduce((s, p) => s + f(p), 0) / list.length : 0;
    v[AUD.tiltX] = n ? (avg((p) => p.tx) + 1) / 2 : 0.5;
    v[AUD.tiltY] = n ? (avg((p) => p.ty) + 1) / 2 : 0.5;
    v[AUD.shake] = avg((p) => p.sh);
    v[AUD.touch] = avg((p) => p.to);
    const touching = this.people.filter((p) => p.to === 1);
    v[AUD.fingerX] = touching.length ? avg((p) => p.px, touching) : 0.5;
    v[AUD.fingerY] = touching.length ? avg((p) => p.py, touching) : 0.5;
    const fire = this.emojis.filter((x) => x.e === EMOJIS.indexOf('🔥')).length;
    // every phone sending 🔥 as often as allowed for 10 s (about 6 each) = full
    v[AUD.fire] = Math.min(1, fire / Math.max(1, n * 6));
    const recent = this.emojis.filter((x) => now - x.at < 3000).length;
    v[AUD.emoji] = Math.min(1, recent / Math.max(1, n * 2));
    for (let k = 1; k < EMOJIS.length; k++) {
      let sum = 0;
      for (const x of this.emojis) if (x.e === k && x.at <= now) sum += Math.exp(-(now - x.at) / EMOJI_FADE_MS);
      v[AUD.each + k - 1] = Math.min(1, sum / EMOJI_SLOTS);
    }
    for (let i = 0; i < PER_PHONE_LOOK; i++) {
      const p = this.people[i];
      v[AUD.look + 2 * i] = !p ? 0.5 : p.to ? p.px : (p.tx + 1) / 2;
      v[AUD.look + 2 * i + 1] = !p ? 0.5 : p.to ? p.py : (p.ty + 1) / 2;
    }
    return v.map((x) => Math.min(1, Math.max(0, x)));
  }
}
