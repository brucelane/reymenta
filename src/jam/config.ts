// The Jam's setup (2026-11-20, studies/reymenta-jam.md): a JSON file next to the organiser's Live template set,
// default assets/jam/jam.json (JAM_FILE). It says which MIDI output Live listens to, the scale, the tracks
// (instrument, drums, effects) with their MIDI channel, pads, knobs (CCs) and the clips phones may launch (each a
// note on `clipChannel`, MIDI-mapped to a clip slot in Live). Validated: a typo in the file must not crash the server.
import { isModeName, MODES, PITCH_NAMES } from '../core/scales';

export type TrackKind = 'notes' | 'drums' | 'fx';

export interface JamKnob { name: string; cc: number; channel: number; min: number; max: number; value: number }
export interface JamClip { name: string; note: number; on: boolean }
export interface JamPad { name: string; note: number }
export interface JamTrack {
  name: string;
  kind: TrackKind;
  /** MIDI channel 1-16 (notes and drums) */
  channel: number;
  /** notes: the octave of the lowest root (MIDI octave: 1 = C1..B1, a bass's E1 = 28) */
  octave: number;
  /** notes: how many octaves of pads */
  octaves: number;
  /** drums: one pad per sound */
  pads: JamPad[];
  knobs: JamKnob[];
  clips: JamClip[];
  /** at most this many notes held at once on the track (all phones together) */
  voices: number;
  velocity: number;
  color: string;
}
export interface JamConfig {
  title: string;
  /** a MIDI output name (or part of one) on the PC running TSWebsocketServer: "loopMIDI Jam", "IAC Driver Jam" */
  port: string;
  /** the tempo when no Link is there (the beat pulse on the phones) */
  bpm: number;
  /** notes start on this grid (beats: 0.25 = a sixteenth) when Link gives the beat; 0 = at once */
  quantize: number;
  root: number;
  mode: string;
  clipChannel: number;
  tracks: JamTrack[];
}

const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v: unknown, lo: number, hi: number, def: number) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : def);
const numIn = (v: unknown, lo: number, hi: number, def: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : def);
const text = (v: unknown, max: number, def: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : def);
const COLOR = /^#[0-9a-fA-F]{6}$/;
const PALETTE = ['#e06c75', '#e5c07b', '#98c379', '#56b6c2', '#61afef', '#c678dd', '#d19a66', '#be5046'];

/** "A", "F#", "Bb" -> 0..11 */
export function rootOf(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 12) return v;
  const m = typeof v === 'string' ? /^([A-Ga-g])([#b]?)$/.exec(v.trim()) : null;
  if (!m) return undefined;
  const i = PITCH_NAMES.indexOf(m[1].toUpperCase());
  return (i + (m[2] === '#' ? 1 : m[2] === 'b' ? 11 : 0)) % 12;
}

const MAX_TRACKS = 12;

/** jam.json -> a clean config, or the reason it can't be used. */
export function validateJam(raw: unknown): JamConfig | string {
  if (!obj(raw)) return 'not a JSON object';
  if (typeof raw.port !== 'string' || !raw.port.trim()) return '"port" (the MIDI output Live listens to) is missing';
  if (!Array.isArray(raw.tracks) || !raw.tracks.length) return '"tracks" is missing or empty';
  const root = rootOf(raw.root);
  if (root === undefined) return `"root" must be a note name (C, F#, Bb...), not ${JSON.stringify(raw.root)}`;
  const mode = typeof raw.mode === 'string' && isModeName(raw.mode) ? raw.mode : undefined;
  if (!mode) return `"mode" must be one of ${Object.keys(MODES).join(', ')}`;
  const clipChannel = int(raw.clipChannel, 1, 16, 16);
  const tracks: JamTrack[] = [];
  for (const [i, t] of raw.tracks.slice(0, MAX_TRACKS).entries()) {
    if (!obj(t)) return `track ${i + 1}: not an object`;
    const kind: TrackKind = t.kind === 'drums' || t.kind === 'fx' ? t.kind : 'notes';
    const channel = int(t.channel, 1, 16, i + 1);
    const knobs: JamKnob[] = (Array.isArray(t.knobs) ? t.knobs : []).slice(0, 4).flatMap((k) => {
      if (!obj(k) || int(k.cc, 0, 127, -1) < 0) return [];
      const min = int(k.min, 0, 127, 0), max = int(k.max, 0, 127, 127);
      return [{ name: text(k.name, 24, `CC ${k.cc}`), cc: k.cc as number, channel: int(k.channel, 1, 16, channel), min, max, value: numIn(k.value, 0, 1, 0.5) }];
    });
    const clips: JamClip[] = (Array.isArray(t.clips) ? t.clips : []).slice(0, 8).flatMap((c) => {
      if (!obj(c) || int(c.note, 0, 127, -1) < 0) return [];
      return [{ name: text(c.name, 24, `clip ${c.note}`), note: c.note as number, on: c.on !== false }];
    });
    const pads: JamPad[] = kind === 'drums'
      ? (Array.isArray(t.pads) ? t.pads : []).slice(0, 16).flatMap((p) => (obj(p) && int(p.note, 0, 127, -1) >= 0 ? [{ name: text(p.name, 16, String(p.note)), note: p.note as number }] : []))
      : [];
    if (kind === 'drums' && !pads.length && !clips.length) return `track ${i + 1} (drums): no "pads" and no "clips"`;
    if (kind === 'fx' && !knobs.length) return `track ${i + 1} (fx): no "knobs"`;
    tracks.push({
      name: text(t.name, 24, `Track ${i + 1}`), kind, channel,
      octave: int(t.octave, 0, 7, kind === 'notes' ? 3 : 0), octaves: int(t.octaves, 1, 3, 2),
      pads, knobs, clips, voices: int(t.voices, 1, 16, 6), velocity: int(t.velocity, 1, 127, 100),
      color: typeof t.color === 'string' && COLOR.test(t.color) ? t.color : PALETTE[i % PALETTE.length],
    });
  }
  return {
    title: text(raw.title, 60, 'Jam'), port: raw.port.trim().slice(0, 100), bpm: numIn(raw.bpm, 20, 300, 120),
    quantize: [0, 0.125, 0.25, 0.5, 1].includes(raw.quantize as number) ? (raw.quantize as number) : 0.25,
    root, mode, clipChannel, tracks,
  };
}

/** The MIDI note of pad `pad` on a notes track: the scale's degrees from the lowest root up, `octaves` of them + the
 *  top root. undefined outside. */
export function padNote(t: Pick<JamTrack, 'octave' | 'octaves'>, root: number, mode: string, pad: number): number | undefined {
  const steps = MODES[mode]?.steps;
  if (!steps || !Number.isInteger(pad) || pad < 0 || pad > steps.length * t.octaves) return undefined;
  const low = (t.octave + 1) * 12 + root;
  const note = low + Math.floor(pad / steps.length) * 12 + steps[pad % steps.length];
  return note >= 0 && note <= 127 ? note : undefined;
}

/** How many pads a track shows. */
export const padCount = (t: JamTrack, mode: string) => (t.kind === 'drums' ? t.pads.length : t.kind === 'notes' ? (MODES[mode]?.steps.length ?? 7) * t.octaves + 1 : 0);
