// The Workshop's fretboard: bass (4 and 5 strings) and guitar, a root + mode from scales.ts, note names or degrees,
// frets 0–12 (or 0–24, scrolled sideways). Settings kept on the phone; "the track's key" when opened from a track.
import { useState } from 'react';
import { MODES, PITCH_NAMES, trackTonality, type ModeName } from '../../../src/core/scales';
import type { Lang } from '../i18n';
import { fretRows, INSTRUMENTS, stringNames } from './fretboardNotes';
import type { Track } from './library';
import type { WTexts } from './texts';

interface Settings { instrument: string; tuning: string; root: number; mode: ModeName; labels: 'names' | 'degrees'; frets24: boolean }
const KEY = 'reymenta:fretboard';
const DEFAULTS: Settings = { instrument: 'bass4', tuning: 'EADG', root: 4, mode: 'minor', labels: 'names', frets24: false };

function load(): Settings {
  try {
    const s = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } as Settings;
    if (!INSTRUMENTS[s.instrument] || !INSTRUMENTS[s.instrument].tunings[s.tuning] || !MODES[s.mode] || !(s.root >= 0 && s.root < 12)) return DEFAULTS;
    return s;
  } catch { return DEFAULTS; }
}

const MARKERS = new Set([3, 5, 7, 9, 12, 15, 17, 19, 21, 24]);

export function FretboardScreen({ t, lang, track }: { t: WTexts; lang: Lang; track?: Track }) {
  const trackKey = trackTonality(track);
  const [s, setS] = useState<Settings>(() => (trackKey ? { ...load(), root: trackKey.root, mode: trackKey.mode } : load()));
  const set = (c: Partial<Settings>) => setS((cur) => {
    const next = { ...cur, ...c };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* blocked */ }
    return next;
  });
  const inst = INSTRUMENTS[s.instrument];
  const open = inst.tunings[s.tuning];
  const frets = s.frets24 ? 24 : 12;
  const rows = fretRows(open, s.root, s.mode, frets, s.labels);
  const names = stringNames(open);

  return (
    <section className="ws-fret">
      <div className="ws-form">
        <label>{t.instrument}
          <select value={s.instrument} onChange={(e) => { const i = e.target.value; set({ instrument: i, tuning: Object.keys(INSTRUMENTS[i].tunings)[0] }); }}>
            {Object.entries(INSTRUMENTS).map(([k, v]) => <option key={k} value={k}>{v[lang]}</option>)}
          </select>
        </label>
        <label>{t.tuning}
          <select value={s.tuning} onChange={(e) => set({ tuning: e.target.value })}>
            {Object.keys(inst.tunings).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label>{t.root}
          <select value={s.root} onChange={(e) => set({ root: Number(e.target.value) })}>
            {PITCH_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}
          </select>
        </label>
        <label>{t.mode}
          <select value={s.mode} onChange={(e) => set({ mode: e.target.value })}>
            {Object.entries(MODES).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
          </select>
        </label>
      </div>
      <div className="ws-seg">
        <button className={s.labels === 'names' ? 'on' : ''} onClick={() => set({ labels: 'names' })}>{t.names}</button>
        <button className={s.labels === 'degrees' ? 'on' : ''} onClick={() => set({ labels: 'degrees' })}>{t.degrees}</button>
        <button className={s.frets24 ? 'on' : ''} onClick={() => set({ frets24: !s.frets24 })}>{t.frets24}</button>
      </div>
      {trackKey && (trackKey.root !== s.root || trackKey.mode !== s.mode) && (
        <button className="ws-link" onClick={() => set({ root: trackKey.root, mode: trackKey.mode })}>
          {t.trackKey(`${PITCH_NAMES[trackKey.root]} ${MODES[trackKey.mode].label}`)}
        </button>
      )}
      <div className="ws-neck-wrap">
        <table className={`ws-neck${s.frets24 ? ' wide' : ''}`}>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                <th>{names[r]}</th>
                {row.map((c) => (
                  <td key={c.fret} className={c.fret === 0 ? 'nut' : ''}>
                    {c.inScale && <span className={`ws-dot${c.root ? ' root' : ''}`}>{c.label}</span>}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="ws-neck-nums">
              <th />
              {rows[0].map((c) => <td key={c.fret}>{MARKERS.has(c.fret) || c.fret === 0 ? c.fret : ''}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
