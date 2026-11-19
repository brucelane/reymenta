// A track's exports (studies/reymenta-workshop.md step 6): MIDI (.mid), Ableton Live (.als, written here: alsWrite.ts)
// and the whole track as one JSON (library.ts exportWholeTrack). Lazy-loaded by TrackScreen; Strudel loads only when
// the patch's notes are included (its haps are queried), the .als template (12 KB) only for an .als.
import { useState } from 'react';
import { patchCycles } from '../../../src/core/strudelLength';
import { gunzipText, gzipText, writeAlsXml } from './alsWrite';
import { exportWholeTrack, type Library, type Track } from './library';
import { buildExportSong, safeName, songToMidiFile, type ExportSong } from './songExport';
import { download } from './storage';
import type { WTexts } from './texts';

/** bars queried from a patch that doesn't say its length (the WebApp's FALLBACK_CYCLES) */
const FALLBACK_BARS = 8;
const MAX_BARS = 1024;

/** The template's text: a data URL in its own small chunk once built (vite.config.ts), a file URL in dev. */
async function loadTemplate(): Promise<string> {
  const { default: url } = await import('./als/empty.als?url');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`template: ${res.status}`);
  return gunzipText(new Uint8Array(await res.arrayBuffer()));
}

export default function ExportSection({ t, lib, folder, track }: { t: WTexts; lib: Library; folder: string; track: Track }) {
  const patch = lib.patches[folder];
  const [withPatch, setWithPatch] = useState(!!patch);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const name = safeName(folder);

  const song = async (): Promise<ExportSong> => {
    let haps;
    if (withPatch && patch) {
      setMsg(t.exportReading);
      const { queryHaps } = await import('./strudelEngine');
      haps = await queryHaps(patch, Math.min(MAX_BARS, Math.ceil(patchCycles(patch) ?? FALLBACK_BARS)));
    }
    return buildExportSong({
      title: track.title, bpm: track.bpm, beatsPerBar: track.beatsPerBar ?? lib.tabs[folder]?.song.cycleBeats,
      tab: lib.tabs[folder], drums: lib.drums[folder], patch, haps,
    });
  };
  const run = (f: () => Promise<void>) => async () => {
    setError(''); setMsg(''); setBusy(true);
    try { await f(); } catch (e) { setMsg(''); setError(t.exportError((e as Error)?.message ?? String(e))); } finally { setBusy(false); }
  };
  const done = (s: ExportSong) => setMsg(t.exportDone(s.parts.length, s.parts.reduce((n, p) => n + p.notes.length, 0)));

  const midi = run(async () => {
    const s = await song();
    if (!s.parts.length) return setMsg(t.exportNothing);
    download(`${name}.mid`, songToMidiFile(s), 'audio/midi');
    done(s);
  });
  const als = run(async () => {
    const [s, template] = await Promise.all([song(), loadTemplate()]);
    if (!s.parts.length) return setMsg(t.exportNothing);
    download(`${name}.als`, await gzipText(writeAlsXml(template, s)), 'application/octet-stream');
    done(s);
  });

  return (
    <div className="ws-export">
      <p className="ws-dim ws-small">{t.exportHelp}</p>
      {patch && (
        <label className="ws-check">
          <input type="checkbox" checked={withPatch} onChange={(e) => setWithPatch(e.target.checked)} /> {t.exportWithPatch}
        </label>
      )}
      <div className="ws-actions">
        <button onClick={midi} disabled={busy}>{t.exportMidi}</button>
        <button onClick={als} disabled={busy}>{t.exportAls}</button>
        <button onClick={() => download(`${name}.track.json`, exportWholeTrack(lib, folder) ?? '')} disabled={busy}>{t.exportJson}</button>
      </div>
      <p className="ws-dim ws-small">{t.exportAlsNote}</p>
      {error && <p className="ws-error">{error}</p>}
      {msg && <p className="ws-msg">{msg}</p>}
    </div>
  );
}
