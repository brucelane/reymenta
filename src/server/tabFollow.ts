// The playing bass tab for the phones that ask for it (2026-11-19, studies/reymenta-workshop.md step 1).
// What TSWebsocketServer broadcasts tells where the song is:
// - Cinder's transport state (from "cinder": folder, playing, position in seconds): the bar comes from the track's bpm
//   (track.json) and the tab's beats per cycle (<folder>.tab.json, song.cycleBeats);
// - a WebApp's (from "webapp", 2026-11-19: cycle = the song's bar - 1, cps), sent while its wav or its Strudel pane plays
//   and no Cinder runs.
// Cinder wins while its state is fresh. Phones subscribe with {t:"tab",on:true}: they get the tab once per track
// ({t:"tab",...}, compact) and the clock ({t:"clock"}) every second while playing and on every change; others get
// nothing (cloud phones count against the Web PubSub quota).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TabClockMsg, TabMsg } from '../room/protocol';

interface Clock { folder: string; playing: boolean; cycle: number; cps: number; at: number; source: 'cinder' | 'webapp' }

const FOLDER = /^[A-Za-z0-9 _.-]{1,64}$/;
const okFolder = (f: unknown): f is string => typeof f === 'string' && FOLDER.test(f) && !f.includes('..');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

export class TabFollow {
  private cinder?: Clock;
  private webapp?: Clock;
  private tracks = new Map<string, { bpm: number; tab: TabMsg | null }>();

  constructor(private readonly assetsGlsl: string, private readonly now: () => number = Date.now) {}

  /** A message TSWebsocketServer broadcast (anything: only transport states are read). True when the clock changed. */
  receive(raw: string): boolean {
    if (!raw.startsWith('{"event":"transport"') && !raw.includes('"transport"')) return false;
    let m: Record<string, unknown>;
    try { m = JSON.parse(raw); } catch { return false; }
    if (m.event !== 'transport' || m.message !== 'state' || !okFolder(m.folder)) return false;
    const before = this.current();
    if (m.from === 'cinder') {
      const position = num(m.position) ?? 0;
      const track = this.track(m.folder);
      const cps = track.bpm > 0 ? track.bpm / 60 / (track.tab?.bb ?? 4) : 0;
      this.cinder = { folder: m.folder, playing: m.playing === true, cycle: position * cps, cps, at: this.now(), source: 'cinder' };
    } else if (m.from === 'webapp') {
      const cycle = num(m.cycle);
      const cps = num(m.cps);
      if (cycle === undefined || cps === undefined || cps < 0 || cps > 10) return false;
      this.webapp = { folder: m.folder, playing: m.playing === true, cycle, cps, at: this.now(), source: 'webapp' };
    } else return false;
    const after = this.current();
    if (!before || !after) return !!after;
    const drift = Math.abs(this.cycleNow(before) - this.cycleNow(after));
    return before.folder !== after.folder || before.playing !== after.playing || drift > 0.25;
  }

  /** The clock to follow: Cinder's while fresh (8 s: it sends every 3 s when stopped), else the newest WebApp's. */
  private current(): Clock | undefined {
    const t = this.now();
    if (this.cinder && t - this.cinder.at < 8000) return this.cinder;
    if (this.webapp && t - this.webapp.at < (this.webapp.playing ? 2500 : 8000)) return this.webapp;
    return undefined;
  }

  private cycleNow(c: Clock): number {
    return c.cycle + (c.playing ? ((this.now() - c.at) / 1000) * c.cps : 0);
  }

  /** The clock message for the phones, or undefined when nothing is known. */
  clock(): TabClockMsg | undefined {
    const c = this.current();
    if (!c) return undefined;
    return { t: 'clock', f: c.folder, p: c.playing ? 1 : 0, c: Math.round(this.cycleNow(c) * 1000) / 1000, s: Math.round(c.cps * 10000) / 10000 };
  }

  get playing(): boolean { return this.current()?.playing ?? false; }
  get folder(): string | undefined { return this.current()?.folder; }

  /** The folder's tab for the phones (null: the track has no tab). Read once per folder; `forget` after a change. */
  tab(folder: string): TabMsg | null {
    return okFolder(folder) ? this.track(folder).tab : null;
  }
  forget(folder?: string) { if (folder) this.tracks.delete(folder); else this.tracks.clear(); }

  private track(folder: string): { bpm: number; tab: TabMsg | null } {
    const cached = this.tracks.get(folder);
    if (cached) return cached;
    let meta: { bpm?: unknown; title?: unknown; tabFile?: unknown } = {};
    try { meta = JSON.parse(readFileSync(join(this.assetsGlsl, folder, 'track.json'), 'utf8')); } catch { /* none */ }
    const bpm = num(meta.bpm) ?? 0;
    let tab: TabMsg | null = null;
    const file = typeof meta.tabFile === 'string' && /^[\w .()+-]+\.tab\.json$/.test(meta.tabFile) ? meta.tabFile : `${folder}.tab.json`;
    try {
      const d = JSON.parse(readFileSync(join(this.assetsGlsl, folder, file), 'utf8'));
      const notes: Array<[number, number, number, number]> = [];
      for (const n of Array.isArray(d.tab) ? d.tab : []) {
        const beat = num(n?.beat), string = num(n?.string), fret = num(n?.fret), dur = num(n?.dur);
        if (beat !== undefined && string !== undefined && fret !== undefined) notes.push([beat, string, fret, dur ?? 0.25]);
      }
      const sec: Array<[number, string]> = [];
      for (const l of Array.isArray(d.song?.locators) ? d.song.locators : []) {
        const beat = num(l?.beat);
        if (beat !== undefined && typeof l?.name === 'string') sec.push([beat, l.name.replace(/^#/, '').slice(0, 24)]);
      }
      tab = {
        t: 'tab', f: folder, title: typeof meta.title === 'string' ? meta.title.slice(0, 60) : folder,
        bb: num(d.song?.cycleBeats) ?? 4, n: notes, sec, tuning: typeof d.tuning === 'string' ? d.tuning : 'EADG',
      };
    } catch { /* no tab */ }
    const entry = { bpm, tab };
    this.tracks.set(folder, entry);
    return entry;
  }
}
