// A track of the Workshop: its track.json fields (title, artist, bpm, key, tuning, beats per bar) and its bass tab,
// viewed with the Show's TabView (3 bars, still) or edited (TabEditor).
import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { MODES, PITCH_NAMES, trackTonality, type ModeName } from '../../../src/core/scales';
import type { Lang } from '../i18n';
import { TabView, type ClockAt } from '../TabView';
import type { Catalogue } from './catalogue';
import { deleteTrack, exportTab, exportTrack, setHydra, setTab, updateTrack, type Library, type Track } from './library';
import { download } from './storage';
import { TabEditor } from './TabEditor';
import { editorBars, newTab, noteWarnings, setBeatsPerBar, setTempo, setTuning, toTabMsg, isTuning } from './tabEdit';
import type { WTexts } from './texts';

// Strudel and CodeMirror load only when one of these opens (step 4)
const StrudelSection = lazy(() => import('./StrudelSection'));
const DrumSection = lazy(() => import('./DrumSection'));
// hydra-synth and its editor: only when the Hydra section opens (step 5)
const HydraSection = lazy(() => import('./HydraSection'));
// MIDI / .als / whole-track JSON (step 6)
const ExportSection = lazy(() => import('./ExportSection'));

const BPB = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 7.5, 8, 9, 12];

export function TrackScreen({ t, lib, folder, cat, setLib, update, fretboard, deleted }: {
  t: WTexts; lang: Lang; lib: Library; folder: string; cat?: Catalogue; setLib: (l: Library) => void;
  update: (f: (l: Library) => Library) => void; fretboard: () => void; deleted: () => void;
}) {
  const track = lib.tracks.find((x) => x.folder === folder);
  const tab = lib.tabs[folder];
  const [editing, setEditing] = useState(false);
  const [bar, setBar] = useState(0);
  const touchX = useRef<number | undefined>(undefined);
  const [strudelOpen, setStrudelOpen] = useState(false);
  const [drumsOpen, setDrumsOpen] = useState(false);
  const [hydraOpen, setHydraOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  // the patch playing: the bass tab follows its bar; stopped, the tab stays where it was
  const [clock, setClock] = useState<ClockAt | undefined>();
  const onClock = (c: ClockAt | undefined) => {
    setClock((old) => {
      if (!c && old) setBar(Math.max(0, Math.floor(old.msg.c + ((performance.now() - old.at) / 1000) * old.msg.s)));
      return c;
    });
  };
  const bars = useMemo(() => (tab ? editorBars(tab) : []), [tab]);
  const msg = useMemo(() => (tab && track ? toTabMsg(tab, folder, track.title) : undefined), [tab, track, folder]);
  const marks = useMemo(() => new Set((tab?.tab ?? []).flatMap((n, i) => (noteWarnings(n).length ? [i] : []))), [tab]);
  if (!track) return <p className="ws-dim">{t.empty}</p>;

  const tonality = trackTonality(track) ?? { root: 4, mode: 'minor' as ModeName };
  const bpb = track.beatsPerBar ?? tab?.song.cycleBeats ?? 4;
  const tuning = tab?.tuning ?? (isTuning(track.tab?.tuning) ? track.tab.tuning : 'EADG');
  const change = (c: Partial<Track>, tabChange?: (x: NonNullable<typeof tab>) => NonNullable<typeof tab>) => {
    let next = updateTrack(lib, folder, c);
    if (tab && tabChange) next = setTab(next, folder, tabChange(tab));
    setLib(next);
  };
  const go = (b: number) => setBar(Math.max(0, Math.min(bars.length - 1, b)));
  const artists = cat?.artists ?? [];

  return (
    <section className="ws-track">
      <div className="ws-form">
        <label>{t.titlePh}<input value={track.title} maxLength={120} onChange={(e) => change({ title: e.target.value })} /></label>
        <label>{t.artist}
          <input value={track.artist ?? ''} list="ws-artists" maxLength={40}
            onChange={(e) => change({ artist: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') || undefined })} />
          <datalist id="ws-artists">{artists.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</datalist>
        </label>
        <label>{t.bpm}<input type="number" inputMode="decimal" min={20} max={400} value={track.bpm ?? ''}
          onChange={(e) => { const v = Number(e.target.value); if (v >= 1 && v <= 999) change({ bpm: v }, (x) => setTempo(x, v)); }} /></label>
        <label>{t.key}
          <select value={tonality.root} onChange={(e) => change({ tonality: PITCH_NAMES[Number(e.target.value)], mode: tonality.mode })}>
            {PITCH_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
        </label>
        <label>{t.mode}
          <select value={tonality.mode} onChange={(e) => change({ tonality: PITCH_NAMES[tonality.root], mode: e.target.value })}>
            {Object.entries(MODES).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
        </label>
        <label>{t.tuning}
          <select value={tuning} onChange={(e) => {
            const v = e.target.value;
            if (isTuning(v)) change({ tab: { ...track.tab, tuning: v } }, (x) => setTuning(x, v));
          }}>
            <option value="EADG">EADG</option>
            <option value="DADG">DADG</option>
            <option value="BEAD" disabled>{t.bead}</option>
          </select>
        </label>
        <label>{t.beatsPerBar}
          <select value={bpb} onChange={(e) => { const v = Number(e.target.value); change({ beatsPerBar: v }, (x) => setBeatsPerBar(x, v)); }}>
            {(BPB.includes(bpb) ? BPB : [...BPB, bpb].sort((a, b) => a - b)).map((v) => <option key={v} value={v}>{Number.isInteger(v) ? `${v}/4` : `${v * 2}/8`}</option>)}
          </select>
        </label>
      </div>
      <button className="ws-link" onClick={fretboard}>{t.fretboard}: {PITCH_NAMES[tonality.root]} {MODES[tonality.mode].label}</button>

      <h2>{t.tab}</h2>
      {!tab ? (
        <><p className="ws-dim">{t.noTab}</p>
          <button onClick={() => setLib(setTab(lib, folder, newTab({ source: `${folder}.workshop`, tempo: track.bpm ?? 120, beatsPerBar: bpb, tuning })))}>{t.makeTab}</button></>
      ) : (
        <>
          <div className="ws-seg">
            <button className={editing ? '' : 'on'} onClick={() => setEditing(false)}>{t.view}</button>
            <button className={editing ? 'on' : ''} onClick={() => setEditing(true)}>{t.edit}</button>
          </div>
          {editing ? (
            <TabEditor t={t} tab={tab} bar={Math.min(bar, bars.length - 1)} setBar={go} onChange={(x) => setLib(setTab(lib, folder, x))} />
          ) : (
            <>
              <div className="ws-barnav">
                <button onClick={() => go(bar - 3)} aria-label={t.prevBar}>«</button>
                <button onClick={() => go(bar - 1)} aria-label={t.prevBar}>‹</button>
                <span>{t.bar} {Math.min(bar, bars.length - 1) + 1}/{bars.length}</span>
                <button onClick={() => go(bar + 1)} aria-label={t.nextBar}>›</button>
                <button onClick={() => go(bar + 3)} aria-label={t.nextBar}>»</button>
              </div>
              <div className="ws-tabview"
                onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX; }}
                onTouchEnd={(e) => {
                  const x0 = touchX.current, x1 = e.changedTouches[0]?.clientX;
                  touchX.current = undefined;
                  if (x0 !== undefined && x1 !== undefined && Math.abs(x1 - x0) > 40) go(bar + (x1 < x0 ? 1 : -1));
                }}>
                {clock
                  ? <TabView tab={msg} clock={clock} marks={marks} texts={{ tabWaiting: t.loading, tabNone: t.noTab, tabStopped: '' }} />
                  : <TabView tab={msg} bar={Math.min(bar, bars.length - 1)} marks={marks} texts={{ tabWaiting: t.loading, tabNone: t.noTab, tabStopped: '' }} />}
              </div>
              {marks.size > 0 && <p className="ws-warn ws-small">{t.warnings(marks.size)}</p>}
            </>
          )}
        </>
      )}

      <h2 className="ws-fold">
        <button onClick={() => setStrudelOpen((o) => !o)} aria-expanded={strudelOpen}>{strudelOpen ? '▾' : '▸'} {t.strudel}</button>
      </h2>
      {strudelOpen && (
        <Suspense fallback={<p className="ws-dim">{t.loading}</p>}>
          <StrudelSection t={t} folder={folder} track={track} code={lib.patches[folder]} original={lib.originals[folder]} update={update} onClock={onClock} />
        </Suspense>
      )}
      <h2 className="ws-fold">
        <button onClick={() => setDrumsOpen((o) => !o)} aria-expanded={drumsOpen}>{drumsOpen ? '▾' : '▸'} {t.drums}</button>
      </h2>
      {drumsOpen && (
        <Suspense fallback={<p className="ws-dim">{t.loading}</p>}>
          <DrumSection t={t} folder={folder} track={track} drums={lib.drums[folder]} patch={lib.patches[folder]} update={update} />
        </Suspense>
      )}
      <h2 className="ws-fold">
        <button onClick={() => setHydraOpen((o) => !o)} aria-expanded={hydraOpen}>{hydraOpen ? '▾' : '▸'} {t.hydra}</button>
      </h2>
      {hydraOpen && (
        <Suspense fallback={<p className="ws-dim">{t.loading}</p>}>
          <HydraSection t={t} name={folder} title={track.title} bpm={track.bpm} code={lib.hydra[folder]}
            save={(c) => update((l) => setHydra(l, folder, c))} />
        </Suspense>
      )}

      <h2 className="ws-fold">
        <button onClick={() => setExportOpen((o) => !o)} aria-expanded={exportOpen}>{exportOpen ? '▾' : '▸'} {t.exports}</button>
      </h2>
      {exportOpen && (
        <Suspense fallback={<p className="ws-dim">{t.loading}</p>}>
          <ExportSection t={t} lib={lib} folder={folder} track={track} />
        </Suspense>
      )}

      <div className="ws-actions">
        <button onClick={() => download('track.json', exportTrack(lib, folder) ?? '')}>{t.download} track.json</button>
        {tab && <button onClick={() => download(`${folder}.tab.json`, exportTab(lib, folder) ?? '')}>{t.download} {folder}.tab.json</button>}
        <button className="ws-danger" onClick={() => { if (confirm(t.confirmDelete(track.title))) { setLib(deleteTrack(lib, folder)); deleted(); } }}>{t.delete}</button>
      </div>
    </section>
  );
}
