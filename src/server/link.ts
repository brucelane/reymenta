// Ableton Link for the playing bass tab (2026-11-20): Live's tempo and start/stop reach the tab-view phones through
// the audience server, so the tab follows Live on the same network (local first: no internet involved).
// Optional: Link is a native module (C++ SDK, built by node-gyp on install), not a dependency of this repo. To use it:
//   pnpm add -O @ktamas77/abletonlink      (needs the Visual Studio C++ build tools on Windows, Xcode on the Mac)
//   LINK=1 pnpm server                     (LINK_FOLDER=<folder> to fix the track; LINK_FROM_BAR=n: Live's start = bar n)
// and in Live: Link on, "Start Stop Sync" on (Preferences > Link, Tempo & MIDI).
// Without the module the server says so once and runs as before.
import type { LinkState } from './tabFollow';

interface KtLink {
  enable(on: boolean): void;
  enableStartStopSync(on: boolean): void;
  getTempo(): number;
  getBeat(): number;
  isPlaying(): boolean;
  getNumPeers(): number;
}

export interface LinkPoller { state(): LinkState; close(): void }

/** Starts Link and calls `onState` every `ms`; undefined (with the reason) when the module isn't installed. */
export async function startLink(onState: (s: LinkState) => void, ms = 100): Promise<LinkPoller | string> {
  let link: KtLink;
  try {
    const name = '@ktamas77/abletonlink'; // a variable: TypeScript and bundlers don't look for it
    const mod = (await import(name)) as { AbletonLink: new (bpm: number) => KtLink };
    link = new mod.AbletonLink(120);
    link.enable(true);
    link.enableStartStopSync(true);
  } catch (e) {
    return `Ableton Link not available (pnpm add -O @ktamas77/abletonlink): ${(e as Error)?.message ?? e}`;
  }
  const state = (): LinkState => ({ tempo: link.getTempo(), beat: link.getBeat(), playing: link.isPlaying(), peers: link.getNumPeers() });
  const timer = setInterval(() => {
    try { onState(state()); } catch { /* a bad reading: skipped */ }
  }, ms);
  return { state, close: () => { clearInterval(timer); try { link.enable(false); } catch { /* closing */ } } };
}
