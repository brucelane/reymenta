// The tuner (2026-11-20): the phone's microphone, a needle in cents, the note, and the strings of the chosen
// instrument and tuning (the fretboard's list: bass 4/5, guitar 6). Green within ±3 cents. A tap on a string plays
// its note (tune by ear). A4 from 432 to 445 Hz. In the Workshop (home + header) and on the Show page (header).
// The microphone opens only on the Start tap; nothing leaves the phone.
import { useEffect, useRef, useState } from 'react';
import type { Lang } from '../i18n';
import { INSTRUMENTS } from '../workshop/fretboardNotes';
import { openMic, type Mic } from './mic';
import { freqToMidi, keyName, midiToFreq, nearest, nearestString, Smoother } from './pitch';
import './tuner.css';

const TEXTS = {
  fr: {
    title: 'Accordeur', start: 'Activer le micro', stop: 'Arrêter', instrument: 'Instrument', tuning: 'Accordage',
    mode: 'Mode', auto: 'Chromatique', strings: 'Par corde', listening: 'Jouez une corde…', inTune: 'Juste',
    flat: 'trop bas', sharp: 'trop haut', a4: 'La 4', tapString: 'Touchez une corde pour entendre sa note.',
    micError: (e: string) => `Micro indisponible : ${e}`, close: 'Fermer',
    privacy: 'Le son reste sur le téléphone : seule la hauteur est calculée.',
  },
  en: {
    title: 'Tuner', start: 'Turn the microphone on', stop: 'Stop', instrument: 'Instrument', tuning: 'Tuning',
    mode: 'Mode', auto: 'Chromatic', strings: 'By string', listening: 'Play a string…', inTune: 'In tune',
    flat: 'flat', sharp: 'sharp', a4: 'A4', tapString: 'Tap a string to hear its note.',
    micError: (e: string) => `Microphone not available: ${e}`, close: 'Close',
    privacy: 'The sound stays on the phone: only the pitch is worked out.',
  },
};

const STORE = 'reymenta:tuner';
interface Prefs { instrument: string; tuning: string; a4: number; byString: boolean }
const DEFAULT: Prefs = { instrument: 'bass4', tuning: 'EADG', a4: 440, byString: true };
function loadPrefs(): Prefs {
  try {
    const p = { ...DEFAULT, ...JSON.parse(localStorage.getItem(STORE) ?? '{}') } as Prefs;
    if (!INSTRUMENTS[p.instrument]?.tunings[p.tuning]) return DEFAULT;
    if (!(p.a4 >= 400 && p.a4 <= 480)) p.a4 = 440;
    return p;
  } catch { return DEFAULT; }
}

export default function Tuner({ lang, onClose }: { lang: Lang; onClose?: () => void }) {
  const t = TEXTS[lang];
  const [prefs, setPrefs] = useState(loadPrefs);
  const [on, setOn] = useState(false);
  const [error, setError] = useState('');
  const [reading, setReading] = useState<number | undefined>(); // fractional MIDI key
  const mic = useRef<Mic | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const save = (p: Partial<Prefs>) => setPrefs((old) => {
    const next = { ...old, ...p };
    try { localStorage.setItem(STORE, JSON.stringify(next)); } catch { /* private mode */ }
    return next;
  });

  // ~30 readings a second while on
  useEffect(() => {
    if (!on) return;
    const smooth = new Smoother(5);
    let raf = 0, last = 0;
    const tick = (now: number) => {
      if (now - last > 33 && mic.current) {
        last = now;
        const p = mic.current.read();
        setReading(smooth.push(p && p.clarity > 0.8 ? freqToMidi(p.freq, prefsRef.current.a4) : undefined));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [on]);
  useEffect(() => () => { mic.current?.close(); mic.current = null; }, []);

  const start = async () => {
    setError('');
    try {
      mic.current = await openMic();
      setOn(true);
    } catch (e) {
      setError(t.micError((e as Error)?.message ?? String(e)));
    }
  };
  const stop = () => { mic.current?.close(); mic.current = null; setOn(false); setReading(undefined); };
  // a reference tone needs an audio context: the mic's when on, else a short-lived one
  const tone = (key: number) => {
    const f = midiToFreq(key, prefs.a4);
    if (mic.current) return mic.current.tone(f);
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator(), gain = ctx.createGain();
      osc.type = 'triangle'; osc.frequency.value = f;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 2.05);
      osc.onended = () => void ctx.close();
    } catch { /* no audio */ }
  };

  const inst = INSTRUMENTS[prefs.instrument];
  const open = inst.tunings[prefs.tuning];
  let target: number | undefined, cents: number | undefined, stringIndex: number | undefined;
  if (reading !== undefined) {
    const f = midiToFreq(reading, prefs.a4);
    if (prefs.byString) {
      const s = nearestString(f, open, prefs.a4);
      stringIndex = s.index; target = open[s.index]; cents = s.cents;
    } else {
      const n = nearest(f, prefs.a4);
      target = n.key; cents = n.cents;
    }
  }
  const shown = cents === undefined ? 0 : Math.max(-50, Math.min(50, cents));
  const good = cents !== undefined && Math.abs(cents) <= 3;
  const far = cents !== undefined && Math.abs(cents) > 50; // by string: a string tuned well off (or the wrong one)

  return (
    <section className="tuner">
      <header className="tuner-head">
        <b>{t.title}</b>
        {onClose && <button onClick={() => { stop(); onClose(); }} aria-label={t.close}>✕</button>}
      </header>
      <div className="tuner-form">
        <label>{t.instrument}
          <select value={prefs.instrument} onChange={(e) => { const i = e.target.value; save({ instrument: i, tuning: Object.keys(INSTRUMENTS[i].tunings)[0] }); }}>
            {Object.entries(INSTRUMENTS).map(([k, v]) => <option key={k} value={k}>{v[lang]}</option>)}
          </select>
        </label>
        <label>{t.tuning}
          <select value={prefs.tuning} onChange={(e) => save({ tuning: e.target.value })}>
            {Object.keys(inst.tunings).map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label>{t.a4}
          <input type="number" inputMode="numeric" min={432} max={445} value={prefs.a4}
            onChange={(e) => { const v = Number(e.target.value); if (v >= 400 && v <= 480) save({ a4: v }); }} />
        </label>
        <div className="tuner-seg">
          <button className={prefs.byString ? 'on' : ''} onClick={() => save({ byString: true })}>{t.strings}</button>
          <button className={prefs.byString ? '' : 'on'} onClick={() => save({ byString: false })}>{t.auto}</button>
        </div>
      </div>

      <div className={`tuner-dial${good ? ' good' : ''}`}>
        <div className="tuner-note">{target !== undefined ? keyName(target, lang === 'fr') : on ? '…' : '–'}</div>
        <svg viewBox="-110 -100 220 110" className="tuner-gauge" aria-hidden="true">
          {[-50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50].map((c) => {
            const a = (c / 50) * (Math.PI / 3);
            const r0 = c === 0 ? 70 : c % 50 === 0 ? 78 : 84;
            return <line key={c} x1={Math.sin(a) * r0} y1={-Math.cos(a) * r0} x2={Math.sin(a) * 92} y2={-Math.cos(a) * 92} className="tuner-tick" />;
          })}
          {(() => {
            const a = (shown / 50) * (Math.PI / 3);
            return <line x1={0} y1={0} x2={Math.sin(a) * 88} y2={-Math.cos(a) * 88} className={`tuner-needle${cents === undefined ? ' idle' : ''}`} />;
          })()}
          <circle r={5} className="tuner-hub" />
        </svg>
        <div className="tuner-cents">
          {cents === undefined ? (on ? t.listening : '') : good ? t.inTune : `${cents > 0 ? '+' : ''}${Math.round(cents)} ¢ ${cents < 0 ? t.flat : t.sharp}${far ? ' !' : ''}`}
        </div>
      </div>

      <div className="tuner-strings">
        {open.map((k, i) => (
          <button key={i} className={stringIndex === i ? (good ? 'good' : 'now') : ''} onClick={() => tone(k)}>{keyName(k, lang === 'fr')}</button>
        ))}
      </div>
      <p className="tuner-dim">{t.tapString}</p>

      {on ? <button className="tuner-main" onClick={stop}>{t.stop}</button> : <button className="tuner-main" onClick={() => void start()}>{t.start}</button>}
      {error && <p className="tuner-error">{error}</p>}
      <p className="tuner-dim">{t.privacy}</p>
    </section>
  );
}
