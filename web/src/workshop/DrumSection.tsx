// A track's drum tab (studies/reymenta-workshop.md step 4): one bar at a time, a row per drum voice, 16th steps;
// tap to toggle. Plays with Strudel (drums.ts drumCode, the generated code shown read-only), adds itself to the
// track's patch, or is read from the patch (its drum haps quantized). Lazy-loaded with the engine (TrackScreen).
import { useEffect, useMemo, useState } from 'react';
import { patchCycles } from '../../../src/core/strudelLength';
import {
  addDrumBar, addRow, copyDrumBar, drumCode, drumExpression, drumTabFromHaps, DRUM_VOICES, isHit, kitHas, KITS, newDrumTab,
  removeDrumBar, removeRow, setKit, toggleStep, type DrumTab,
} from './drums';
import { setDrums, setPatch, type Library, type Track } from './library';
import { addDrumsToPatch } from './patch';
import { useEngine } from './StrudelSection';
import { audioState, cycle, engineState, play, queryHaps, stop } from './strudelEngine';
import type { WTexts } from './texts';

export default function DrumSection({ t, folder, track, drums, patch, update }: {
  t: WTexts; folder: string; track: Track; drums?: DrumTab; patch?: string; update: (f: (l: Library) => Library) => void;
}) {
  const engine = useEngine();
  const mine = engine.playing && engine.owner === 'drums';
  const [bar, setBar] = useState(0);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pos, setPos] = useState<{ bar: number; step: number } | undefined>();
  const bpb = track.beatsPerBar ?? 4;
  const code = useMemo(() => (drums ? drumCode(drums, { bpm: track.bpm, beatsPerBar: bpb }) : ''), [drums, track.bpm, bpb]);
  const set = (d: DrumTab | undefined) => update((l) => setDrums(l, folder, d));
  const at = drums ? Math.max(0, Math.min(bar, drums.bars.length - 1)) : 0;

  // while playing: the bar shown follows, the step playing is lit
  useEffect(() => {
    if (!mine || !drums) { setPos(undefined); return; }
    const timer = window.setInterval(() => {
      const c = cycle();
      const b = Math.floor(c) % drums.bars.length;
      const steps = drums.bars[b]?.steps ?? 16;
      setPos({ bar: b, step: Math.floor((c - Math.floor(c)) * steps) });
      setBar(b);
    }, 50);
    return () => window.clearInterval(timer);
  }, [mine, drums]);
  // leaving: stop the drums
  useEffect(() => () => { if (engineOwnerIsDrums()) stop(); }, []);

  const run = async (f: () => Promise<void>) => {
    setError(''); setMsg(''); setBusy(true);
    try {
      await f();
      if (audioState() === 'suspended') setMsg(t.audioBlocked);
    } catch (e) {
      setError(t.evalError((e as Error)?.message ?? String(e)));
    } finally {
      setBusy(false);
    }
  };
  const readFromPatch = () => {
    if (!patch || (drums && !confirm(t.drumsReplace))) return;
    void run(async () => {
      setMsg(t.drumsReading);
      const total = patchCycles(patch);
      const haps = await queryHaps(patch, Math.ceil(total ?? 8));
      const d = drumTabFromHaps(haps, { bars: total ?? undefined, beatsPerBar: bpb, kit: drums?.kit });
      if (!d) return setMsg(t.drumsReadNone);
      set(d);
      setBar(0);
      setMsg(t.drumsReadDone(d.bars.length));
    });
  };
  const toPatch = () => {
    if (!drums) return;
    const next = addDrumsToPatch(patch ?? '', drumExpression(drums));
    if (!next) return setMsg(t.copyFailed);
    update((l) => setPatch(l, folder, next));
    setMsg(t.copiedToPatch);
  };

  if (!drums) {
    return (
      <div className="ws-drums">
        <p className="ws-dim">{t.drumsNone}</p>
        <div className="ws-actions">
          <button onClick={() => set(newDrumTab({ beatsPerBar: bpb, bars: 1, basic: true }))}>{t.drumsMake}</button>
          {patch && <button onClick={readFromPatch} disabled={busy}>{t.drumsRead}</button>}
        </div>
        {error && <p className="ws-error">{error}</p>}
        {msg && <p className="ws-msg">{msg}</p>}
      </div>
    );
  }

  const b = drums.bars[at];
  const unused = DRUM_VOICES.filter((v) => !drums.rows.includes(v));
  const beatEvery = 4; // a beat = 4 sixteenths
  return (
    <div className="ws-drums">
      <div className="ws-transport">
        <button className="ws-play" disabled={busy} onClick={() => void run(() => play(code, 0, 'drums'))}>{t.play}</button>
        <button onClick={() => stop()} disabled={!mine}>{t.stop}</button>
        <label className="ws-kit">{t.kit}
          <select value={drums.kit} onChange={(e) => set(setKit(drums, e.target.value))}>
            {(KITS.some((k) => k.id === drums.kit) ? KITS : [{ id: drums.kit, voices: '' }, ...KITS]).map((k) => <option key={k.id} value={k.id}>{k.id}</option>)}
          </select>
        </label>
      </div>
      <div className="ws-barnav">
        <button onClick={() => setBar(Math.max(0, at - 1))} aria-label={t.prevBar}>‹</button>
        <span>{t.bar} {at + 1}/{drums.bars.length}</span>
        <button onClick={() => setBar(Math.min(drums.bars.length - 1, at + 1))} aria-label={t.nextBar}>›</button>
      </div>
      <div className="ws-grid-wrap">
        <div className="ws-dgrid" style={{ gridTemplateColumns: `2.6em repeat(${b.steps}, minmax(16px, 1fr)) 1.8em` }}>
          {drums.rows.map((v) => (
            <Row key={v} label={v} lacks={!kitHas(drums.kit, v)} lacksText={t.kitLacks} steps={b.steps} beatEvery={beatEvery}
              hit={(s) => isHit(b, v, s)} now={pos && pos.bar === at ? pos.step : -1}
              toggle={(s) => set(toggleStep(drums, at, v, s))} remove={() => set(removeRow(drums, v))} removeLabel={t.remove} />
          ))}
        </div>
      </div>
      <div className="ws-actions">
        {unused.length > 0 && (
          <select value="" aria-label={t.addRow} onChange={(e) => { const v = unused.find((x) => x === e.target.value); if (v) set(addRow(drums, v)); }}>
            <option value="">{t.addRow}</option>
            {unused.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        )}
        <button onClick={() => { set(addDrumBar(drums, at)); setBar(at + 1); }}>{t.addBar}</button>
        <button onClick={() => { set(copyDrumBar(drums, at)); setBar(at + 1); }}>{t.copyBar}</button>
        <button onClick={() => set(removeDrumBar(drums, at))} disabled={drums.bars.length <= 1}>{t.removeBar}</button>
      </div>
      <div className="ws-actions">
        {patch && <button onClick={readFromPatch} disabled={busy}>{t.drumsRead}</button>}
        <button onClick={toPatch}>{t.copyToPatch}</button>
      </div>
      {error && <p className="ws-error">{error}</p>}
      {engine.issues.length > 0 && <p className="ws-warn ws-small">{t.soundsMissing(engine.issues.join('; '))}</p>}
      {msg && <p className="ws-msg">{msg}</p>}
      <details className="ws-gencode">
        <summary>{t.code}</summary>
        <pre>{code}</pre>
      </details>
    </div>
  );
}

const engineOwnerIsDrums = () => engineState().playing && engineState().owner === 'drums';

function Row({ label, lacks, lacksText, steps, beatEvery, hit, now, toggle, remove, removeLabel }: {
  label: string; lacks: boolean; lacksText: string; steps: number; beatEvery: number; hit: (s: number) => boolean; now: number;
  toggle: (s: number) => void; remove: () => void; removeLabel: string;
}) {
  return (
    <>
      <span className={`ws-grid-name${lacks ? ' lacks' : ''}`} title={lacks ? lacksText : undefined}>{label}</span>
      {Array.from({ length: steps }, (_, s) => (
        <button key={s} className={`ws-dcell${hit(s) ? ' on' : ''}${s % beatEvery === 0 ? ' beat' : ''}${s === now ? ' now' : ''}`}
          aria-label={`${label} ${s + 1}`} aria-pressed={hit(s)} onClick={() => toggle(s)} />
      ))}
      <button className="ws-drow-x" onClick={remove} aria-label={`${removeLabel} ${label}`}>✕</button>
    </>
  );
}
