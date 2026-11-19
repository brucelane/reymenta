// The bass tab editor: one bar as a grid of 16th steps x 4 strings. Tap a step on a string, type the fret on the
// number pad, pick a length; delete; add/remove bars; name the bar's section. Every change goes through tabEdit.ts,
// so the TabData stays what the WebApp's Track pane opens.
import { useEffect, useMemo, useState } from 'react';
import { STEPS_PER_BEAT, STRING_NAMES } from '../../../src/core/songGrid';
import { addBar, deleteNote, editorBars, LENGTHS, noteAt, noteWarnings, removeBar, setDuration, setNote, setSection, type WTab } from './tabEdit';
import type { WTexts } from './texts';

export function TabEditor({ t, tab, bar: barIndex, setBar, onChange }: {
  t: WTexts; tab: WTab; bar: number; setBar: (b: number) => void; onChange: (tab: WTab) => void;
}) {
  const bars = useMemo(() => editorBars(tab), [tab]);
  const bar = bars[Math.max(0, Math.min(barIndex, bars.length - 1))];
  const steps = Math.max(1, Math.round(bar.beats * STEPS_PER_BEAT));
  const [sel, setSel] = useState<{ step: number; string: number } | undefined>();
  const [len, setLen] = useState(0.5);
  const [buf, setBuf] = useState('');
  const sectionAt = tab.song.locators.find((l) => Math.abs(l.beat - bar.start) < 1e-6)?.name.replace(/^#/, '') ?? '';
  const [section, setSectionText] = useState(sectionAt);
  useEffect(() => { setSectionText(sectionAt); setSel(undefined); setBuf(''); }, [bar.index, sectionAt]);

  const beatOf = (step: number) => bar.start + step / STEPS_PER_BEAT;
  const selIndex = sel ? noteAt(tab, beatOf(sel.step), sel.string) : -1;
  const selNote = selIndex >= 0 ? tab.tab[selIndex] : undefined;
  // notes of this bar, and the steps each one holds, per string
  const cells = useMemo(() => {
    const map = new Map<string, { i: number; start: boolean }>();
    tab.tab.forEach((n, i) => {
      const s0 = Math.round((n.beat - bar.start) * STEPS_PER_BEAT);
      const s1 = s0 + Math.max(1, Math.round(n.dur * STEPS_PER_BEAT));
      for (let s = Math.max(0, s0); s < Math.min(steps, s1); s++) {
        const k = `${n.string}:${s}`;
        if (!map.get(k)?.start) map.set(k, { i, start: s === s0 });
      }
    });
    return map;
  }, [tab, bar.start, steps]);

  const put = (fret: number) => {
    if (!sel) return;
    const dur = selNote?.dur ?? len;
    onChange(setNote(tab, { beat: beatOf(sel.step), string: sel.string, fret, dur }));
    setBuf('');
    // on to the next free step, to type a line quickly
    const next = sel.step + Math.max(1, Math.round(dur * STEPS_PER_BEAT));
    if (next < steps) setSel({ step: next, string: sel.string });
  };
  const digit = (d: number) => {
    if (!sel) return;
    let b = buf + d;
    if (Number(b) > 24) b = String(d);
    const v = Number(b);
    if (b.length >= 2 || v * 10 > 24) put(v);
    else setBuf(b);
  };
  const names = STRING_NAMES[tab.tuning];
  const warn = selNote ? noteWarnings(selNote) : [];

  return (
    <div className="ws-editor">
      <div className="ws-barnav">
        <button onClick={() => setBar(bar.index - 1)} disabled={bar.index === 0} aria-label={t.prevBar}>‹</button>
        <span>{t.bar} {bar.index + 1}/{bars.length}{bar.beats !== 4 ? ` (${Number.isInteger(bar.beats) ? `${bar.beats}/4` : `${bar.beats * 2}/8`})` : ''}</span>
        <button onClick={() => (bar.index === bars.length - 1 ? (onChange(addBar(tab, bar.index)), setBar(bar.index + 1)) : setBar(bar.index + 1))} aria-label={t.nextBar}>›</button>
        <button onClick={() => { onChange(addBar(tab, bar.index)); setBar(bar.index + 1); }}>{t.addBar}</button>
        <button onClick={() => { onChange(removeBar(tab, bar.index)); setBar(Math.max(0, bar.index - 1)); }} disabled={bars.length <= 1}>{t.removeBar}</button>
      </div>
      <form className="ws-section" onSubmit={(e) => { e.preventDefault(); onChange(setSection(tab, bar.index, section)); }}>
        <label>{t.section}
          <input value={section} placeholder={t.sectionPh} maxLength={32} onChange={(e) => setSectionText(e.target.value)}
            onBlur={() => { if (section !== sectionAt) onChange(setSection(tab, bar.index, section)); }} />
        </label>
      </form>

      <div className="ws-grid-wrap">
        <div className="ws-grid" style={{ gridTemplateColumns: `1.6em repeat(${steps}, minmax(1.5em, 1fr))` }}>
          <span />
          {Array.from({ length: steps }, (_, s) => <span key={s} className="ws-grid-beat">{s % STEPS_PER_BEAT === 0 ? s / STEPS_PER_BEAT + 1 : ''}</span>)}
          {[3, 2, 1, 0].map((string) => (
            <Row key={string} name={names[string]} string={string} steps={steps} cells={cells} tab={tab} sel={sel}
              onPick={(step) => { setSel({ step, string }); setBuf(''); }} />
          ))}
        </div>
      </div>

      {!sel ? <p className="ws-dim ws-small">{t.tapStep}</p> : (
        <div className="ws-pad">
          <p className="ws-small">
            {names[sel.string]} · {t.bar} {bar.index + 1}, {Math.floor(sel.step / STEPS_PER_BEAT) + 1}.{(sel.step % STEPS_PER_BEAT) + 1}
            {' · '}{t.fret} <b>{buf || (selNote ? selNote.fret : '–')}</b>
            {warn.includes('range') && <span className="ws-warn"> · {t.warnRange}</span>}
            {warn.includes('open') && <span className="ws-warn"> · {t.warnOpen}</span>}
          </p>
          <div className="ws-digits">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d) => <button key={d} onClick={() => digit(d)}>{d}</button>)}
            <button onClick={() => buf && put(Number(buf))} disabled={!buf}>{t.ok}</button>
            <button onClick={() => setBuf('')}>{t.clear}</button>
          </div>
          <div className="ws-lengths">
            <span className="ws-small">{t.length}</span>
            {LENGTHS.map((l, k) => (
              <button key={l} className={(selNote ? Math.abs(selNote.dur - l) < 1e-6 : len === l) ? 'on' : ''}
                onClick={() => { setLen(l); if (selIndex >= 0) onChange(setDuration(tab, selIndex, l)); }}>{t.lengths[k]}</button>
            ))}
          </div>
          <button className="ws-danger" disabled={selIndex < 0} onClick={() => onChange(deleteNote(tab, selIndex))}>{t.deleteNote}</button>
        </div>
      )}
    </div>
  );
}

function Row({ name, string, steps, cells, tab, sel, onPick }: {
  name: string; string: number; steps: number; cells: Map<string, { i: number; start: boolean }>; tab: WTab;
  sel?: { step: number; string: number }; onPick: (step: number) => void;
}) {
  return (
    <>
      <span className="ws-grid-name">{name}</span>
      {Array.from({ length: steps }, (_, s) => {
        const c = cells.get(`${string}:${s}`);
        const n = c ? tab.tab[c.i] : undefined;
        const bad = n && noteWarnings(n).length > 0;
        const cls = ['ws-cell', s % STEPS_PER_BEAT === 0 ? 'beat' : '', c?.start ? 'note' : c ? 'held' : '', bad ? 'bad' : '',
          sel && sel.step === s && sel.string === string ? 'sel' : ''].filter(Boolean).join(' ');
        return <button key={s} className={cls} onClick={() => onPick(s)}>{c?.start ? n!.fret : ''}</button>;
      })}
    </>
  );
}
