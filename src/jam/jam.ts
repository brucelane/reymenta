// The Jam (2026-11-20, studies/reymenta-jam.md): phones play the organiser's Live template together. Pure logic,
// no sockets, no MIDI port: the server (main.ts) feeds it phone messages and sends what comes out to
// TSWebsocketServer ({"event":"midimsg"}), which plays it on the MIDI output Live listens to. test/jam.test.ts.
// - Each phone picks a track. Notes tracks: pads over the scale (padNote: a phone can't play a wrong note);
//   drums: one pad per sound. Held as long as the pad is held (note on / note off), at most 10 s.
// - Notes start on the Link beat's grid (`quantize`, a sixteenth by default) when Live's beat is known: Wi-Fi and
//   4G delays disappear and everyone plays in time. Without Link they go out at once.
// - Several phones on a track: a note sounds once while any of them holds it; `voices` caps the notes held.
// - Knobs (CCs): the average of the phones moving them (each phone's value counts for 15 s after its last move).
// - Clips: only those the organiser switched on; a short note on `clipChannel`, MIDI-mapped to a clip slot in Live
//   (Live's own launch quantization keeps them in time). At most one launch per phone every 2 s.
import { MODES } from '../core/scales';
import { padCount, padNote, type JamConfig } from './config';

export interface MidiMsg { type: 'noteon' | 'noteoff' | 'cc'; channel: number; note?: number; velocity?: number; controller?: number; value?: number }
/** messages to send, `delayMs` from now (quantized notes) */
export type MidiOut = (msgs: MidiMsg[], delayMs: number) => void;
/** Live's beat through Link (undefined: no Link) */
export type BeatClock = () => { beat: number; bpm: number; playing: boolean } | undefined;

/** Server -> phone: the jam (tracks, scale, who plays what). */
export interface JamStateMsg {
  t: 'jam';
  on: boolean;
  title: string;
  /** root 0..11, mode name, its steps */
  root: number;
  mode: string;
  steps: number[];
  bpm: number;
  link: boolean;
  tracks: Array<{ n: string; k: string; c: string; pads: string[]; base: number; knobs: string[]; kv: number[]; clips: Array<[number, string]>; p: number }>;
  /** the phone's track (-1: none) */
  mine: number;
}
/** Server -> jam phones: the beat, each second and on changes (the phones pulse between) */
export interface JamBeatMsg { t: 'jbeat'; b: number; bpm: number; p: 0 | 1 }

const MAX_HOLD_MS = 10000;
const KNOB_WINDOW_MS = 15000;
const CLIP_COOLDOWN_MS = 2000;

interface Held { track: number; note: number; at: number }
interface Player { track: number; held: Map<number, Held>; knobs: Map<string, { v: number; at: number }>; lastClip: number }

export class Jam {
  open: boolean;
  private players = new Map<string, Player>();
  /** track:note -> how many phones hold it */
  private sounding = new Map<string, number>();
  private sentKnob = new Map<string, number>();
  private knobValue = new Map<string, number>();

  constructor(public cfg: JamConfig, private readonly out: MidiOut, private readonly clock: BeatClock, private readonly now: () => number = Date.now, open = false) {
    this.open = open;
    cfg.tracks.forEach((t, ti) => t.knobs.forEach((k, ki) => this.knobValue.set(`${ti}:${ki}`, k.value)));
  }

  get count(): number { return this.players.size; }

  /** A phone opened the Jam screen (or closed it: leave). */
  join(id: string): void {
    if (!this.players.has(id)) this.players.set(id, { track: -1, held: new Map(), knobs: new Map(), lastClip: -Infinity });
  }
  leave(id: string): void {
    const p = this.players.get(id);
    if (!p) return;
    this.releaseAll(p);
    this.players.delete(id);
  }

  /** The phone's track (-1: none). False when it can't be picked. */
  pick(id: string, track: number): boolean {
    const p = this.players.get(id);
    if (!p || !Number.isInteger(track) || track < -1 || track >= this.cfg.tracks.length) return false;
    if (p.track !== track) { this.releaseAll(p); p.knobs.clear(); }
    p.track = track;
    return true;
  }

  /** A pad pressed (on) or released. `vel` 0..1 (optional: the track's velocity). */
  pad(id: string, pad: number, on: boolean, vel?: number): void {
    const p = this.players.get(id);
    if (!this.open || !p || p.track < 0) return;
    const t = this.cfg.tracks[p.track];
    if (!on) { this.release(p, pad); return; }
    if (p.held.has(pad)) return;
    const note = t.kind === 'drums' ? t.pads[pad]?.note : t.kind === 'notes' ? padNote(t, this.cfg.root, this.cfg.mode, pad) : undefined;
    if (note === undefined) return;
    const key = `${p.track}:${note}`;
    const n = this.sounding.get(key) ?? 0;
    if (n === 0 && this.voices(p.track) >= t.voices) return; // the track is full
    p.held.set(pad, { track: p.track, note, at: this.now() });
    this.sounding.set(key, n + 1);
    if (n === 0) {
      const velocity = vel !== undefined && vel > 0 && vel <= 1 ? Math.max(1, Math.round(vel * 127)) : t.velocity;
      this.out([{ type: 'noteon', channel: t.channel, note, velocity }], this.quantizeDelay());
    }
  }

  /** A knob moved (0..1). Sent by tick(). */
  knob(id: string, knob: number, v: number): void {
    const p = this.players.get(id);
    if (!this.open || !p || p.track < 0 || !(v >= 0 && v <= 1)) return;
    if (!this.cfg.tracks[p.track].knobs[knob]) return;
    p.knobs.set(`${p.track}:${knob}`, { v, at: this.now() });
  }

  /** A clip launch (index among the track's clips). */
  clip(id: string, clip: number): boolean {
    const p = this.players.get(id);
    if (!this.open || !p || p.track < 0) return false;
    const c = this.cfg.tracks[p.track].clips[clip];
    const t = this.now();
    if (!c || !c.on || t - p.lastClip < CLIP_COOLDOWN_MS) return false;
    p.lastClip = t;
    this.out([{ type: 'noteon', channel: this.cfg.clipChannel, note: c.note, velocity: 127 }], 0);
    this.out([{ type: 'noteoff', channel: this.cfg.clipChannel, note: c.note }], 100);
    return true;
  }

  /** The organiser: a clip on or off for the phones. */
  setClip(track: number, clip: number, on: boolean): boolean {
    const c = this.cfg.tracks[track]?.clips[clip];
    if (!c) return false;
    c.on = on;
    return true;
  }

  /** The organiser: another scale. Held notes end first (their pads would mean other notes). */
  setScale(root: number, mode: string): boolean {
    if (!(root >= 0 && root < 12) || !MODES[mode]) return false;
    for (const p of this.players.values()) this.releaseAll(p);
    this.cfg = { ...this.cfg, root, mode };
    return true;
  }

  /** Closed: every note off. */
  setOpen(on: boolean): void {
    if (!on) for (const p of this.players.values()) this.releaseAll(p);
    this.open = on;
  }

  /** A new config (reloaded file): notes off, phones keep their track when it still exists. */
  reload(cfg: JamConfig): void {
    for (const p of this.players.values()) {
      this.releaseAll(p);
      p.knobs.clear();
      if (p.track >= cfg.tracks.length) p.track = -1;
    }
    this.cfg = cfg;
    this.knobValue.clear();
    this.sentKnob.clear();
    cfg.tracks.forEach((t, ti) => t.knobs.forEach((k, ki) => this.knobValue.set(`${ti}:${ki}`, k.value)));
  }

  /** ~20 times a second: knobs averaged and sent when they moved, stuck notes released. */
  tick(): void {
    const t = this.now();
    for (const p of this.players.values()) {
      for (const [pad, h] of p.held) if (t - h.at > MAX_HOLD_MS) this.release(p, pad);
    }
    const sums = new Map<string, { s: number; n: number }>();
    for (const p of this.players.values()) {
      for (const [key, k] of p.knobs) {
        if (t - k.at > KNOB_WINDOW_MS) { p.knobs.delete(key); continue; }
        const a = sums.get(key) ?? { s: 0, n: 0 };
        a.s += k.v; a.n++;
        sums.set(key, a);
      }
    }
    for (const [key, a] of sums) this.knobValue.set(key, a.s / a.n);
    const msgs: MidiMsg[] = [];
    if (this.open) {
      this.cfg.tracks.forEach((tr, ti) => tr.knobs.forEach((k, ki) => {
        const key = `${ti}:${ki}`;
        const value = Math.round(k.min + (this.knobValue.get(key) ?? k.value) * (k.max - k.min));
        if (this.sentKnob.get(key) === value || !sums.has(key)) return;
        this.sentKnob.set(key, value);
        msgs.push({ type: 'cc', channel: k.channel, controller: k.cc, value });
      }));
    }
    if (msgs.length) this.out(msgs, 0);
  }

  /** What a phone is shown. */
  state(id?: string): JamStateMsg {
    const c = this.cfg;
    const counts = c.tracks.map(() => 0);
    for (const p of this.players.values()) if (p.track >= 0) counts[p.track]++;
    const steps = MODES[c.mode]?.steps ?? [];
    return {
      t: 'jam', on: this.open, title: c.title, root: c.root, mode: c.mode, steps, bpm: this.clock()?.bpm ?? c.bpm, link: !!this.clock(),
      tracks: c.tracks.map((t, ti) => ({
        n: t.name, k: t.kind, c: t.color,
        pads: t.kind === 'drums' ? t.pads.map((p) => p.name) : Array.from({ length: padCount(t, c.mode) }, () => ''),
        base: (t.octave + 1) * 12 + c.root,
        knobs: t.knobs.map((k) => k.name),
        kv: t.knobs.map((_, ki) => Math.round((this.knobValue.get(`${ti}:${ki}`) ?? 0.5) * 100) / 100),
        clips: t.clips.flatMap((cl, i) => (cl.on ? [[i, cl.name] as [number, string]] : [])),
        p: counts[ti],
      })),
      mine: id ? this.players.get(id)?.track ?? -1 : -1,
    };
  }

  /** The beat for the phones' pulse (Link's, else a clock at the config's tempo). */
  beat(): JamBeatMsg {
    const c = this.clock();
    if (c) return { t: 'jbeat', b: Math.round(c.beat * 1000) / 1000, bpm: Math.round(c.bpm * 100) / 100, p: c.playing ? 1 : 0 };
    return { t: 'jbeat', b: Math.round(((this.now() / 60000) * this.cfg.bpm) * 1000) / 1000, bpm: this.cfg.bpm, p: 1 };
  }

  /** ms to the next grid line of the Link beat (0 without Link or quantize). */
  quantizeDelay(): number {
    const c = this.clock();
    const q = this.cfg.quantize;
    if (!c || !q || !(c.bpm > 0)) return 0;
    const next = Math.ceil(c.beat / q - 1e-9) * q;
    return Math.max(0, ((next - c.beat) * 60000) / c.bpm);
  }

  private voices(track: number): number {
    let n = 0;
    for (const [key, count] of this.sounding) if (count > 0 && key.startsWith(`${track}:`)) n++;
    return n;
  }

  private release(p: Player, pad: number): void {
    const h = p.held.get(pad);
    if (!h) return;
    p.held.delete(pad);
    const key = `${h.track}:${h.note}`;
    const n = (this.sounding.get(key) ?? 1) - 1;
    if (n > 0) { this.sounding.set(key, n); return; }
    this.sounding.delete(key);
    const t = this.cfg.tracks[h.track];
    // after its note on (quantized), never before
    if (t) this.out([{ type: 'noteoff', channel: t.channel, note: h.note }], this.quantizeDelay() + 5);
  }

  private releaseAll(p: Player): void {
    for (const pad of [...p.held.keys()]) this.release(p, pad);
  }
}
