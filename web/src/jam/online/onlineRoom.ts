// The online Jam (2026-11-26): up to 5 players at home, each browser playing everyone's notes itself. No server in
// the middle: the players' pages share an Azure Web PubSub group (api/jamjoin gives the address) and this file is the
// room's logic, pure (no socket, no audio) so it can be tested:
// - the same Jam class as the show's (src/jam/jam.ts) turns my pads and knobs into MIDI-like messages;
// - every message gets a time on one shared beat grid (the server's clock, from api/jamjoin's `now`), a little ahead
//   (MIN_AHEAD_MS) so it reaches the others before it's due: everybody hears the same thing at the same time;
// - presence messages say who's here and on which track (the 5-player cap is kept from them: Web PubSub can't count
//   a group's members);
// - whatever comes from another page is untrusted: parsePeerMessage validates it. The sender is Web PubSub's
//   `fromUserId` (the token's subject, which a page can't fake), not a field of the message;
// - the wire format is short (toWire): the Free tier counts outbound bytes (2 KB units, 20,000 a day) and each message
//   goes out once per other player.
import { Jam, type JamStateMsg, type JamBeatMsg, type MidiMsg } from '../../../../src/jam/jam';
import { validateJam, type JamConfig } from '../../../../src/jam/config';

export const MAX_PLAYERS = 5;
/** a note leaves at least this early: the internet's delay hides inside it */
export const MIN_AHEAD_MS = 150;
/** presence: sent every PRESENCE_MS, a player is gone after PRESENCE_TIMEOUT_MS without one */
export const PRESENCE_MS = 8000;
export const PRESENCE_TIMEOUT_MS = 20000;
/** what one page may send: SEND_RATE messages a second on average, SEND_BURST at once (note offs always go) */
export const SEND_RATE = 12;
export const SEND_BURST = 24;
/** a peer sending more than FLOOD_MAX note messages in FLOOD_WINDOW_MS is muted on this page (a bot, a stuck key) */
export const FLOOD_MAX = 40;
export const FLOOD_WINDOW_MS = 2000;

/** The online jam's instruments: played by the page's own synth (synth.ts), by MIDI channel. */
export const ONLINE_JAM_RAW = {
  title: 'Jam en ligne',
  port: 'online',
  bpm: 110,
  quantize: 0.25,
  root: 'A',
  mode: 'minorPenta',
  tracks: [
    {
      name: 'Drums', kind: 'drums', channel: 10, voices: 8, color: '#e5c07b',
      pads: [
        { name: 'Kick', note: 36 }, { name: 'Snare', note: 38 }, { name: 'Clap', note: 39 },
        { name: 'Hat', note: 42 }, { name: 'Open hat', note: 46 }, { name: 'Rim', note: 37 },
      ],
      knobs: [{ name: 'Filter', cc: 20, value: 1 }],
    },
    { name: 'Bass', kind: 'notes', channel: 1, octave: 1, octaves: 2, voices: 1, color: '#e06c75', knobs: [{ name: 'Cutoff', cc: 74 }, { name: 'Drive', cc: 21, value: 0.3 }] },
    { name: 'Keys', kind: 'notes', channel: 2, octave: 3, octaves: 2, voices: 4, color: '#98c379', knobs: [{ name: 'Cutoff', cc: 74, value: 0.6 }, { name: 'Release', cc: 72, value: 0.4 }] },
    { name: 'Lead', kind: 'notes', channel: 3, octave: 4, octaves: 2, voices: 2, color: '#61afef', knobs: [{ name: 'Cutoff', cc: 74, value: 0.7 }, { name: 'Vibrato', cc: 1, value: 0.2 }] },
    { name: 'Space', kind: 'fx', channel: 16, color: '#c678dd', knobs: [{ name: 'Echo', cc: 91, value: 0.25 }, { name: 'Reverb', cc: 93, value: 0.3 }] },
  ],
};

export function onlineConfig(): JamConfig {
  const c = validateJam(ONLINE_JAM_RAW);
  if (typeof c === 'string') throw new Error(c);
  return c;
}

/** A room code: 3-12 lowercase letters/digits. */
export const ROOM_RE = /^[a-z0-9]{3,12}$/;
export const cleanRoom = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const code = (n: number, rand: () => number) => Array.from({ length: n }, () => ALPHABET[Math.floor(rand() * ALPHABET.length)]).join('');
/** A new room's code: 5 letters/digits without look-alikes. */
export const newRoomCode = (rand: () => number = Math.random) => code(5, rand);
/** A player's id for one session: short (it rides on every message as fromUserId). */
export const newPlayerId = (rand: () => number = Math.random) => code(10, rand);

/** What a player does in the room: pads (music), Hydra visuals, or a Strudel part. */
export type Role = 'music' | 'visuals' | 'strudel';
export const ROLES: Role[] = ['music', 'visuals', 'strudel'];
/** Code sent to the room: Hydra (h, the room's visuals: the latest wins) or Strudel (s, one part per player). */
export type CodeKind = 'h' | 's';
/** at most this much code (characters) per message: 2 KB units, sent to each other player */
export const MAX_CODE = 4000;
/** a player sends code at most once every CODE_COOLDOWN_MS */
export const CODE_COOLDOWN_MS = 2000;

/** Peer -> peers (in the room's group). */
export type PeerMessage =
  /** I'm here, on this track (-1: none), in this role, with this name and colour */
  | { t: 'p'; id: string; tr: number; ro: Role; nm: string; hue: number }
  /** I'm leaving */
  | { t: 'bye'; id: string }
  /** notes and knobs, due at `at` (the shared clock, ms) */
  | { t: 'm'; id: string; at: number; msgs: MidiMsg[] }
  /** code for the room, `v` = when it was sent (the shared clock: the latest Hydra code wins); "" = my part removed */
  | { t: 'c'; id: string; k: CodeKind; v: number; code: string };

const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const KINDS = ['noteon', 'noteoff', 'cc'] as const;
const int = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;

/** One MIDI-like message from a peer, or undefined. */
function cleanMidi(m: unknown): MidiMsg | undefined {
  if (!m || typeof m !== 'object') return undefined;
  const o = m as Record<string, unknown>;
  if (!int(o.channel, 1, 16)) return undefined;
  const channel = o.channel as number;
  if ((o.type === 'noteon' || o.type === 'noteoff') && int(o.note, 0, 127)) {
    return o.type === 'noteon'
      ? { type: 'noteon', channel, note: o.note as number, velocity: int(o.velocity, 1, 127) ? (o.velocity as number) : 100 }
      : { type: 'noteoff', channel, note: o.note as number };
  }
  if (o.type === 'cc' && int(o.controller, 0, 127) && int(o.value, 0, 127)) return { type: 'cc', channel, controller: o.controller as number, value: o.value as number };
  return undefined;
}

/** What goes to the group (the sender's id is added by Web PubSub): p {tr,nm,hue}, bye, m {at, m: [[kind, ch, a, b]]}
 *  with kind 0 note on (a note, b velocity), 1 note off (a note), 2 CC (a controller, b value). */
export function toWire(m: PeerMessage): Record<string, unknown> {
  if (m.t === 'p') return { t: 'p', tr: m.tr, ro: ROLES.indexOf(m.ro), nm: m.nm, hue: m.hue };
  if (m.t === 'bye') return { t: 'bye' };
  if (m.t === 'c') return { t: 'c', k: m.k, v: Math.round(m.v), code: m.code };
  return {
    t: 'm', at: Math.round(m.at),
    m: m.msgs.map((x) => x.type === 'cc' ? [2, x.channel, x.controller, x.value] : x.type === 'noteon' ? [0, x.channel, x.note, x.velocity] : [1, x.channel, x.note]),
  };
}

/** A message from another page (untrusted), or undefined. `from`: Web PubSub's fromUserId; `now`: the shared clock,
 *  to refuse times far off. */
export function parsePeerMessage(raw: unknown, from: unknown, now: number): PeerMessage | undefined {
  if (!raw || typeof raw !== 'object' || typeof from !== 'string' || !ID_RE.test(from)) return undefined;
  const o = raw as Record<string, unknown>;
  const id = from;
  if (o.t === 'bye') return { t: 'bye', id };
  if (o.t === 'p') {
    const nm = typeof o.nm === 'string' ? o.nm.replace(/[\u0000-\u001f]/g, '').slice(0, 40) : '';
    return { t: 'p', id, tr: int(o.tr, -1, 15) ? (o.tr as number) : -1, ro: ROLES[int(o.ro, 0, 2) ? (o.ro as number) : 0], nm, hue: int(o.hue, 0, 360) ? (o.hue as number) : 220 };
  }
  if (o.t === 'c') {
    if ((o.k !== 'h' && o.k !== 's') || typeof o.code !== 'string' || o.code.length > MAX_CODE) return undefined;
    if (typeof o.v !== 'number' || !Number.isFinite(o.v) || o.v > now + 10000) return undefined;
    return { t: 'c', id, k: o.k, v: o.v, code: o.code };
  }
  if (o.t === 'm') {
    if (typeof o.at !== 'number' || !Number.isFinite(o.at) || Math.abs(o.at - now) > 10000 || !Array.isArray(o.m)) return undefined;
    const msgs = o.m.slice(0, 16).map((x) => Array.isArray(x) && int(x[0], 0, 2)
      ? cleanMidi({ type: KINDS[x[0] as number], channel: x[1], note: x[2], controller: x[2], velocity: x[3], value: x[3] })
      : undefined).filter((m): m is MidiMsg => !!m);
    return msgs.length ? { t: 'm', id, at: o.at, msgs } : undefined;
  }
  return undefined;
}

/**
 * When a message the Jam wants `delayMs` from `now` should sound for everyone: on the same grid line or a later one
 * (whole grid steps added), at least MIN_AHEAD_MS ahead. Knobs (delay 0, no grid) go just MIN_AHEAD_MS ahead.
 */
export function dueAt(now: number, delayMs: number, gridMs: number, minAhead = MIN_AHEAD_MS): number {
  let at = now + delayMs;
  if (gridMs > 0 && delayMs > 0) while (at - now < minAhead) at += gridMs;
  else if (at - now < minAhead) at = now + minAhead;
  return at;
}

export interface Peer { id: string; track: number; role: Role; name: string; hue: number; seen: number }
/** a piece of code in the room: who sent it, when (shared clock) */
export interface RoomCode { id: string; v: number; code: string }

/** The bar (4 beats) in ms, and the time to the next bar line of the shared clock: Strudel starts there. */
export const barMs = (bpm: number) => (4 * 60000) / bpm;
export const toNextBar = (now: number, bpm: number) => { const b = barMs(bpm); return b - (((now % b) + b) % b); };

/** The room as one page sees it. `send` goes to the group; `play` to this page's synth (shared-clock time). */
export class OnlineRoom {
  readonly cfg = onlineConfig();
  readonly jam: Jam;
  readonly peers = new Map<string, Peer>();
  /** peers muted here for flooding */
  readonly muted = new Set<string>();
  track = -1;
  role: Role = 'music';
  /** the room's visuals: the latest Hydra code anyone sent */
  hydra: RoomCode | undefined;
  /** the room's Strudel parts, one per player */
  readonly strudel = new Map<string, RoomCode>();
  private bucket = SEND_BURST;
  private bucketAt = 0;
  private lastCode = -Infinity;
  private recent = new Map<string, number[]>();

  constructor(
    readonly me: { id: string; name: string; hue: number },
    private readonly now: () => number,
    private readonly send: (m: PeerMessage) => void,
    private readonly play: (msgs: MidiMsg[], at: number) => void,
  ) {
    const clock = () => ({ beat: (this.now() / 60000) * this.cfg.bpm, bpm: this.cfg.bpm, playing: true });
    this.jam = new Jam(this.cfg, (msgs, delayMs) => this.out(msgs, delayMs), clock, now, true);
    this.jam.join(me.id);
  }

  /** a sixteenth (the config's quantize) in ms */
  get gridMs(): number { return (this.cfg.quantize * 60000) / this.cfg.bpm; }

  /** room in the send budget for one more message (refilled at SEND_RATE a second) */
  private canSend(now: number): boolean {
    this.bucket = Math.min(SEND_BURST, this.bucket + ((now - this.bucketAt) / 1000) * SEND_RATE);
    this.bucketAt = now;
    if (this.bucket < 1) return false;
    this.bucket -= 1;
    return true;
  }

  private out(msgs: MidiMsg[], delayMs: number): void {
    const now = this.now();
    // over the budget: notes on and knobs dropped (here too, so everyone hears the same), note offs always sent
    if (!this.canSend(now) && msgs.some((m) => m.type !== 'noteoff')) return;
    // the Jam spaces note offs 5 ms after their grid line: keep that offset when moving to a later line
    const at = Math.round(dueAt(now, delayMs, msgs.some((m) => m.type !== 'cc') ? this.gridMs : 0)); // whole ms, as on the wire
    this.play(msgs, at);
    this.send({ t: 'm', id: this.me.id, at, msgs });
  }

  presence(): PeerMessage { return { t: 'p', id: this.me.id, tr: this.track, ro: this.role, nm: this.me.name, hue: this.me.hue }; }

  /** A newcomer said hello: my presence, and the code I authored that's playing, so it joins in the same state. */
  greet(): void {
    this.send(this.presence());
    if (this.hydra?.id === this.me.id) this.send({ t: 'c', id: this.me.id, k: 'h', v: this.hydra.v, code: this.hydra.code });
    const mine = this.strudel.get(this.me.id);
    if (mine) this.send({ t: 'c', id: this.me.id, k: 's', v: mine.v, code: mine.code });
  }

  setRole(role: Role): void {
    if (!ROLES.includes(role) || role === this.role) return;
    this.role = role;
    this.send(this.presence());
  }

  /**
   * My code to the room (on "Run"): Hydra replaces the room's visuals, Strudel sets my part ("" removes it).
   * 'long' over MAX_CODE, 'wait' within CODE_COOLDOWN_MS of the last one.
   */
  shareCode(k: CodeKind, code: string): 'ok' | 'long' | 'wait' {
    if (code.length > MAX_CODE) return 'long';
    const now = this.now();
    if (now - this.lastCode < CODE_COOLDOWN_MS) return 'wait';
    this.lastCode = now;
    const m: PeerMessage = { t: 'c', id: this.me.id, k, v: Math.round(now), code };
    this.applyCode(m);
    this.send(m);
    return 'ok';
  }

  private applyCode(m: Extract<PeerMessage, { t: 'c' }>): boolean {
    if (m.k === 'h') {
      if (!m.code.trim()) return false;
      const cur = this.hydra;
      // the latest wins; the same message again (a newcomer's greeting) changes nothing
      if (cur && (cur.v > m.v || (cur.v === m.v && cur.id >= m.id))) return false;
      this.hydra = { id: m.id, v: m.v, code: m.code };
      return true;
    }
    const cur = this.strudel.get(m.id);
    if (cur && cur.v >= m.v) return false;
    if (!m.code.trim()) return this.strudel.delete(m.id);
    this.strudel.set(m.id, { id: m.id, v: m.v, code: m.code });
    return true;
  }

  /** The room's Strudel program: every player's part, mine included, in a fixed order (by id). */
  strudelProgram(): string {
    return [...this.strudel.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).map((c) => c.code).join('\n');
  }

  /** others here now (seen within the timeout); a player gone takes its Strudel part with it */
  others(): Peer[] {
    const t = this.now();
    for (const [id, p] of this.peers) if (t - p.seen > PRESENCE_TIMEOUT_MS) { this.peers.delete(id); this.strudel.delete(id); }
    return [...this.peers.values()];
  }

  get full(): boolean { return this.others().length >= MAX_PLAYERS; }

  /** too many messages from this peer lately: muted here (true when it just happened) */
  private flooding(id: string, now: number): boolean {
    const times = (this.recent.get(id) ?? []).filter((t) => now - t < FLOOD_WINDOW_MS);
    times.push(now);
    this.recent.set(id, times);
    if (times.length <= FLOOD_MAX) return false;
    this.muted.add(id);
    this.recent.delete(id);
    this.strudel.delete(id);
    return true;
  }

  /** a message from the group (already parsed); true when the screen should redraw */
  receive(m: PeerMessage): boolean {
    if (m.id === this.me.id) return false;
    if (m.t === 'bye') { this.strudel.delete(m.id); return this.peers.delete(m.id); }
    if (m.t === 'p') {
      const had = this.peers.get(m.id);
      this.peers.set(m.id, { id: m.id, track: m.tr, role: m.ro, name: m.nm, hue: m.hue, seen: this.now() });
      return !had || had.track !== m.tr || had.role !== m.ro || had.name !== m.nm;
    }
    const now = this.now();
    const offs = m.t === 'm' ? m.msgs.filter((x) => x.type === 'noteoff') : [];
    // muted: only its note offs still play (its held notes end), nothing new
    if (this.muted.has(m.id)) {
      if (m.t === 'm' && offs.length) this.play(offs, m.at);
      return false;
    }
    if (this.flooding(m.id, now)) {
      if (m.t === 'm' && offs.length) this.play(offs, m.at);
      return true;
    }
    const p = this.peers.get(m.id);
    if (p) p.seen = now;
    if (m.t === 'c') return this.applyCode(m);
    this.play(m.msgs, m.at);
    return false;
  }

  /** what JamView sends: a track picked, a pad, a knob (clips: none online) */
  input(msg: unknown): boolean {
    if (!msg || typeof msg !== 'object') return false;
    const o = msg as Record<string, unknown>;
    if (o.t === 'jt' && typeof o.k === 'number') {
      if (!this.jam.pick(this.me.id, o.k)) return false;
      this.track = o.k;
      this.send(this.presence());
      return true;
    }
    if (o.t === 'jn' && typeof o.p === 'number') { this.jam.pad(this.me.id, o.p, o.on === 1, typeof o.v === 'number' ? o.v : undefined); return false; }
    if (o.t === 'jk' && typeof o.k === 'number' && typeof o.v === 'number') { this.jam.knob(this.me.id, o.k, o.v); return true; }
    return false;
  }

  /** ~20 times a second: knobs out, stuck notes released, quiet peers dropped */
  tick(): void { this.jam.tick(); }

  /** the screen: the show's JamView state, with every player of the room counted on its track */
  state(): JamStateMsg {
    const s = this.jam.state(this.me.id);
    const counts = s.tracks.map(() => 0);
    if (this.track >= 0) counts[this.track]++;
    for (const p of this.others()) if (p.track >= 0 && p.track < counts.length) counts[p.track]++;
    return { ...s, link: false, tracks: s.tracks.map((t, i) => ({ ...t, p: counts[i] })) };
  }

  beat(): JamBeatMsg { return this.jam.beat(); }

  /** leaving: notes off (sent like any note off), then goodbye */
  leave(): void {
    this.jam.leave(this.me.id);
    this.send({ t: 'bye', id: this.me.id });
  }
}
