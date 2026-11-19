// Standard MIDI files from the notes read from an Ableton set (alsImport.ts, 2026-11-16):
// one file per "tab..." track (tabbass.mid, tabbd.mid...) and one with the whole song, a track
// per "tab..." track. Type 1, 480 ticks per beat; the first track holds the tempo, 4/4 and the
// set's locators as markers. Drum tracks (DRUM_TRACKS, tabdrums) on channel 10, the others on
// 1, 2, 3... in order. Pure (no DOM), so it can be tested with plain Node.
import { AlsSong, DRUM_TRACKS } from "./songGrid";

export const MIDI_PPQ = 480;

const vlq = (v: number): number[] => {
  let n = Math.max(0, Math.round(v));
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
};
const u32 = (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const text = (s: string) => Array.from(new TextEncoder().encode(s));

interface Ev { tick: number; order: number; bytes: number[] }

function chunk(events: Ev[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let last = 0;
  for (const e of events) {
    body.push(...vlq(e.tick - last), ...e.bytes);
    last = e.tick;
  }
  body.push(0, 0xff, 0x2f, 0); // end of track
  return [0x4d, 0x54, 0x72, 0x6b, ...u32(body.length), ...body]; // "MTrk"
}

const meta = (tick: number, type: number, data: number[]): Ev => ({ tick, order: 0, bytes: [0xff, type, ...vlq(data.length), ...data] });
const isDrum = (name: string) => name in DRUM_TRACKS || name === "tabdrums";

function conductor(song: AlsSong, name: string): number[] {
  const usPerBeat = Math.round(60_000_000 / (song.tempo || 120));
  return chunk([
    meta(0, 0x03, text(name)),
    meta(0, 0x51, [(usPerBeat >> 16) & 0xff, (usPerBeat >> 8) & 0xff, usPerBeat & 0xff]),
    meta(0, 0x58, [4, 2, 24, 8]), // 4/4
    ...song.locators.map((l) => meta(Math.round(l.beat * MIDI_PPQ), 0x06, text(l.name))),
  ]);
}

function noteTrack(song: AlsSong, name: string, channel: number): number[] {
  const ch = channel & 0x0f;
  const events: Ev[] = [meta(0, 0x03, text(name))];
  for (const n of song.tracks[name] ?? []) {
    const on = Math.round(n.beat * MIDI_PPQ);
    const off = Math.max(on + 1, Math.round((n.beat + n.dur) * MIDI_PPQ));
    const key = Math.min(127, Math.max(0, Math.round(n.key)));
    const vel = Math.min(127, Math.max(1, Math.round(n.vel)));
    // at the same tick, note-offs before note-ons (a repeated note isn't cut)
    events.push({ tick: on, order: 2, bytes: [0x90 | ch, key, vel] });
    events.push({ tick: off, order: 1, bytes: [0x80 | ch, key, 0] });
  }
  return chunk(events);
}

/** The "tab..." tracks with their MIDI channel (0-based): drums on 9, others 0, 1, 2... skipping 9. */
export function midiChannels(song: AlsSong): [string, number][] {
  let next = 0;
  return Object.keys(song.tracks).map((name) => {
    if (isDrum(name)) return [name, 9];
    if (next === 9) next++;
    return [name, next++ & 0x0f];
  });
}

/** A type 1 MIDI file: the tempo/locators track, then the given "tab..." tracks (all by default). */
export function songToMidi(song: AlsSong, tracks?: string[], title = song.source.replace(/\.als$/i, "")): Uint8Array {
  const chans = midiChannels(song).filter(([name]) => !tracks || tracks.includes(name));
  const header = [0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, 1, 0, chans.length + 1, (MIDI_PPQ >> 8) & 0xff, MIDI_PPQ & 0xff];
  return new Uint8Array([...header, ...conductor(song, title), ...chans.flatMap(([name, ch]) => noteTrack(song, name, ch))]);
}

/** Every file to write: "<track>.mid" per track, and "<song>.mid" with all of them. */
export function songMidiFiles(song: AlsSong, songName: string): { file: string; data: Uint8Array }[] {
  const safe = (s: string) => s.replace(/[^\w .()+-]+/g, "_").replace(/^\.+/, "") || "song";
  return [
    ...Object.keys(song.tracks).map((name) => ({ file: `${safe(name)}.mid`, data: songToMidi(song, [name], name) })),
    { file: `${safe(songName)}.mid`, data: songToMidi(song, undefined, songName) },
  ];
}
