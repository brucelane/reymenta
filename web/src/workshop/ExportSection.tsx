// A track's exports (studies/reymenta-workshop.md step 6): MIDI (.mid), Ableton Live (.als, written here: alsWrite.ts)
// and the whole track as one JSON (library.ts exportWholeTrack). Lazy-loaded by TrackScreen; Strudel loads only when
// the patch's notes are included (its haps are queried), the .als template (12 KB) only for an .als.
import { useState } from 'react';
import { patchCycles } from '../../../src/core/strudelLength';
import { gunzipText, gzipText, writeAlsXml } from './alsWrite';
import { exportWholeTrack, type Library, type Track } from './library';
import { buildExportSong, clickPart, practiceSong, safeName, sectionScenes, songToMidiFile, withCountIn, type ExportSong } from './songExport';
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
  // Ableton extras (2026-11-20)
  const [click, setClick] = useState(false);
  const [countIn, setCountIn] = useState(false);
  const [scenes, setScenes] = useState(true);
  const [pFrom, setPFrom] = useState(1);
  const [pBars, setPBars] = useState(4);
  const [pRate, setPRate] = useState(0.8);
  const [pMute, setPMute] = useState(true);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const name = safeName(folder);

  /** the song with the chosen extras: click track, Session scenes, count-in (last: it moves everything) */
  const extras = (s: ExportSong, o: { click: boolean; countIn: boolean; scenes: boolean }): ExportSong => {
    let x = s;
    if (o.click && x.parts.length && !x.parts.some((p) => p.name === 'click')) x = { ...x, parts: [...x.parts, clickPart(x.beats, x.beatsPerBar)] };
    if (o.scenes) x = { ...x, scenes: sectionScenes(x) };
    if (o.countIn) x = withCountIn(x, 1);
    return x;
  };
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
    const s = extras(await song(), { click, countIn, scenes: false });
    if (!s.parts.length) return setMsg(t.exportNothing);
    download(`${name}.mid`, songToMidiFile(s), 'audio/midi');
    done(s);
  });
  const als = run(async () => {
    const [raw, template] = await Promise.all([song(), loadTemplate()]);
    if (!raw.parts.length) return setMsg(t.exportNothing);
    const s = extras(raw, { click, countIn, scenes });
    download(`${name}.als`, await gzipText(writeAlsXml(template, s)), 'application/octet-stream');
    done(s);
  });
  // a set to practise in Live: the loop on, slower, the bass muted, a click (2026-11-20)
  const practice = run(async () => {
    const [raw, template] = await Promise.all([song(), loadTemplate()]);
    if (!raw.parts.length) return setMsg(t.exportNothing);
    const bars = Math.max(1, Math.round(raw.beats / raw.beatsPerBar));
    const from = Math.min(bars, Math.max(1, Math.round(pFrom))) - 1;
    const s = practiceSong(extras(raw, { click: false, countIn: false, scenes }), { fromBar: from, bars: Math.max(1, Math.min(bars - from, Math.round(pBars))), rate: pRate, muteBass: pMute, click: true });
    download(`${name}-practice.als`, await gzipText(writeAlsXml(template, s)), 'application/octet-stream');
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
      <label className="ws-check"><input type="checkbox" checked={click} onChange={(e) => setClick(e.target.checked)} /> {t.exportClick}</label>
      <label className="ws-check"><input type="checkbox" checked={countIn} onChange={(e) => setCountIn(e.target.checked)} /> {t.exportCountIn}</label>
      <label className="ws-check"><input type="checkbox" checked={scenes} onChange={(e) => setScenes(e.target.checked)} /> {t.exportScenes}</label>
      <div className="ws-actions">
        <button onClick={midi} disabled={busy}>{t.exportMidi}</button>
        <button onClick={als} disabled={busy}>{t.exportAls}</button>
        <button onClick={() => download(`${name}.track.json`, exportWholeTrack(lib, folder) ?? '')} disabled={busy}>{t.exportJson}</button>
      </div>
      <p className="ws-dim ws-small">{t.exportAlsNote}</p>
      <h3>{t.exportPractice}</h3>
      <div className="ws-form">
        <label>{t.exportPracticeFrom}<input type="number" inputMode="numeric" min={1} value={pFrom} onChange={(e) => setPFrom(Number(e.target.value) || 1)} /></label>
        <label>{t.exportPracticeBars}<input type="number" inputMode="numeric" min={1} value={pBars} onChange={(e) => setPBars(Number(e.target.value) || 1)} /></label>
        <label>{t.exportPracticeSpeed}
          <select value={pRate} onChange={(e) => setPRate(Number(e.target.value))}>
            {[0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1].map((r) => <option key={r} value={r}>{Math.round(r * 100)} %{track.bpm ? ` (${Math.round(track.bpm * r)} bpm)` : ''}</option>)}
          </select>
        </label>
        <label className="ws-check"><input type="checkbox" checked={pMute} onChange={(e) => setPMute(e.target.checked)} /> {t.exportPracticeMute}</label>
      </div>
      <div className="ws-actions"><button onClick={practice} disabled={busy}>{t.exportPracticeAls}</button></div>
      <p className="ws-dim ws-small">{t.exportPracticeNote}</p>
      {error && <p className="ws-error">{error}</p>}
      {msg && <p className="ws-msg">{msg}</p>}
    </div>
  );
}
