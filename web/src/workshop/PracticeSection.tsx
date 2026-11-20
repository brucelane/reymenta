// Practising a track's bass tab (2026-11-20), a section of the track screen, lazy-loaded with the Strudel engine.
// Three modes:
// - Play along: the patch plays (all, without the bass, the bass alone, or a click only), looped over chosen bars,
//   slowed down or not, with a count-in; the tab, a "now / next" box and the neck follow.
// - Listen: the same, and the microphone checks each note (practice.ts Scorer): green / red on the tab, a score per
//   section, the bars missed on the last pass (a tap loops one).
// - Step: nothing plays; the tab waits on each note until the microphone hears it (practice.ts Stepper).
// A patch from a file or the catalogue is code: it runs only on Play, like in the Strudel section.
import { useEffect, useMemo, useRef, useState } from 'react';
import { patchCpm } from '../../../src/core/strudelLength';
import type { TabNote } from '../../../src/core/songGrid';
import type { Lang } from '../i18n';
import { TabView, type ClockAt } from '../TabView';
import { openMic, type Mic } from '../tuner/mic';
import { freqToMidi, keyName } from '../tuner/pitch';
import type { Track } from './library';
import { loopNotes, nowNext, position, practiceCode, Scorer, Stepper, type Parts, type PracticeOpts, type ScoreSummary } from './practice';
import { ptexts } from './practiceTexts';
import { audioState, cycle, engineState, playRaw, stop, subscribe, type EngineState } from './strudelEngine';
import { editorBars, fretted, toTabMsg, type WTab } from './tabEdit';

type Mode = 'play' | 'listen' | 'step';
const SPEEDS = [0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1];
const LENGTHS = [1, 2, 4, 8, 16];
const STORE = 'reymenta:practice';

function useEngine(): EngineState {
  const [s, setS] = useState(engineState);
  useEffect(() => subscribe(setS), []);
  return s;
}

function loadLatency(): number {
  try { const v = Number(localStorage.getItem(STORE + ':latency')); return v >= 0 && v <= 500 ? v : 150; } catch { return 150; }
}

export default function PracticeSection({ lang, folder, track, tab, code }: {
  lang: Lang; folder: string; track: Track; tab?: WTab; code?: string;
}) {
  const t = ptexts(lang);
  const engine = useEngine();
  const mine = engine.playing && engine.owner === 'practice';
  const [mode, setMode] = useState<Mode>('play');
  const [parts, setParts] = useState<Parts>(code ? 'nobass' : 'click');
  const [from, setFrom] = useState(0);
  const [len, setLen] = useState(4);
  const [rate, setRate] = useState(1);
  const [countIn, setCountIn] = useState(1);
  const [click, setClick] = useState(!code);
  const [latency, setLatency] = useState(loadLatency);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [pos, setPos] = useState<{ bar: number; countdown?: number; pass: number } | undefined>();
  const [heard, setHeard] = useState<number | undefined>();
  const [summary, setSummary] = useState<ScoreSummary | undefined>();
  const [stepIndex, setStepIndex] = useState(0);
  const [stepping, setStepping] = useState(false);
  const mic = useRef<Mic | null>(null);
  const scorer = useRef<Scorer | null>(null);
  const stepper = useRef<Stepper | null>(null);

  const bars = useMemo(() => (tab ? editorBars(tab) : []), [tab]);
  const notes = useMemo<TabNote[]>(() => (tab ? fretted(tab) : []), [tab]);
  const msgTab = useMemo(() => (tab ? toTabMsg(tab, folder, track.title) : undefined), [tab, folder, track.title]);
  const bpb = tab?.song.cycleBeats ?? track.beatsPerBar ?? 4;
  const bpm = track.bpm ?? tab?.song.tempo ?? 120;
  const total = Math.max(1, bars.length);
  const loopLen = Math.min(len, total - Math.min(from, total - 1));
  const opts: PracticeOpts = { from: Math.min(from, total - 1), bars: loopLen, rate, countIn, click, parts: code ? parts : 'click', bpb };
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const sections = useMemo(() => bars.flatMap((b) => b.sections.map((name) => ({ name, bar: b.index }))), [bars]);
  const sectionOf = (beat: number) => {
    let name = '';
    for (const l of tab?.song.locators ?? []) if (l.beat <= beat + 1e-6) name = l.name.replace(/^#/, '');
    return name;
  };
  const tuningNames = (tab?.tuning ?? 'EADG').split('');

  const closeMic = () => { mic.current?.close(); mic.current = null; setHeard(undefined); };
  // leaving: stop what this section plays, the microphone
  useEffect(() => () => { if (engineState().owner === 'practice') stop(); closeMic(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { try { localStorage.setItem(STORE + ':latency', String(latency)); } catch { /* private */ } }, [latency]);
  // a change of mode stops everything
  useEffect(() => { stopAll(); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const heardKey = () => {
    const p = mic.current?.read();
    return p && p.clarity > 0.8 ? freqToMidi(p.freq) : undefined;
  };

  // playing (play / listen): the position 10 times a second, the microphone ~30 times
  useEffect(() => {
    if (!mine) { setPos(undefined); return; }
    let raf = 0, lastPos = 0, lastMic = 0;
    const tick = (now: number) => {
      const o = optsRef.current;
      if (now - lastMic > 33) {
        lastMic = now;
        if (mic.current && scorer.current) {
          const k = heardKey();
          setHeard(k);
          // the position the player heard `latency` ms ago
          const lag = position(cycle() - (latency / 1000) * engineState().cps, o);
          if (lag.countdown === undefined) scorer.current.tick(lag.bar, lag.pass, k);
        }
      }
      if (now - lastPos > 100) {
        lastPos = now;
        setPos(position(cycle(), o));
        if (scorer.current) setSummary(scorer.current.summary());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mine, latency]); // eslint-disable-line react-hooks/exhaustive-deps

  // step: the microphone ~30 times a second
  useEffect(() => {
    if (!stepping) return;
    let raf = 0, last = 0;
    const tick = (now: number) => {
      if (now - last > 33 && stepper.current) {
        last = now;
        const k = heardKey();
        setHeard(k);
        if (stepper.current.feed(k)) setStepIndex(stepper.current.index);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stepping]); // eslint-disable-line react-hooks/exhaustive-deps

  function stopAll() {
    if (engineState().owner === 'practice') stop();
    setStepping(false);
    closeMic();
  }

  const openTheMic = async (): Promise<boolean> => {
    try {
      mic.current ??= await openMic();
      return true;
    } catch (e) {
      setError(t.micError((e as Error)?.message ?? String(e)));
      return false;
    }
  };

  // Play, called in the click (the audio is resumed by playRaw before any await)
  const onPlay = () => {
    setError('');
    setMsg('');
    if (mode === 'step') {
      void (async () => {
        if (!(await openTheMic())) return;
        stepper.current = new Stepper(loopNotes(notes, opts));
        setStepIndex(0);
        setStepping(true);
      })();
      return;
    }
    const cpm = patchCpm(code ?? '') ?? bpm / bpb;
    const p = playRaw(practiceCode(code, opts, cpm), 'practice');
    scorer.current = null;
    setSummary(undefined);
    void (async () => {
      try {
        await p;
        if (audioState() === 'suspended') setMsg('audio blocked: tap Play again');
        if (mode === 'listen' && (await openTheMic())) {
          const cps = engineState().cps;
          scorer.current = new Scorer(loopNotes(notes, opts), opts, cps * rate * bpb, sectionOf);
        }
      } catch (e) {
        setError(t.evalError((e as Error)?.message ?? String(e)));
      }
    })();
  };

  if (!tab) return <p className="ws-dim">{t.noTab}</p>;

  // what the tab, the boxes and the neck show
  let clock: ClockAt | undefined;
  let fixedBar: number | undefined;
  const tones = new Map<number, string>();
  let nowNote: { i: number; n: TabNote } | undefined, nextNote: { i: number; n: TabNote } | undefined;
  if (mode === 'step' && stepper.current) {
    const st = stepper.current;
    for (let k = 0; k < st.steps.length; k++) {
      for (const { i } of st.steps[k].notes) tones.set(i, k < stepIndex ? 'tab-hit' : k === stepIndex ? 'tab-now' : k === stepIndex + 1 ? 'tab-next' : '');
    }
    const cur = st.steps[stepIndex] ?? st.steps[st.steps.length - 1];
    fixedBar = cur ? Math.floor(cur.beat / bpb + 1e-6) : opts.from;
    nowNote = st.steps[stepIndex]?.notes[0];
    nextNote = st.steps[stepIndex + 1]?.notes[0];
  } else if (mine && pos) {
    if (pos.countdown !== undefined) fixedBar = opts.from;
    else clock = { msg: { t: 'clock', f: folder, p: 1, c: pos.bar, s: engine.cps * rate }, at: performance.now() };
    const nn = nowNext(notes, pos.countdown !== undefined ? opts.from * bpb - 0.01 : pos.bar * bpb);
    nowNote = nn.now; nextNote = nn.next;
    if (nowNote) tones.set(nowNote.i, 'tab-now');
    if (nextNote) tones.set(nextNote.i, 'tab-next');
    if (scorer.current) for (const { i } of loopNotes(notes, opts)) { const v = scorer.current.latest(i); if (v) tones.set(i, v === 'hit' ? 'tab-hit' : 'tab-miss'); }
  } else fixedBar = opts.from;

  const busy = mine || stepping;
  const stepTotal = stepper.current?.steps.length ?? 0;
  return (
    <div className="ws-practice">
      <div className="ws-seg">
        {(['play', 'listen', 'step'] as Mode[]).map((m) => (
          <button key={m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)}>{m === 'play' ? t.modePlay : m === 'listen' ? t.modeListen : t.modeStep}</button>
        ))}
      </div>
      <p className="ws-dim ws-small">{t.modeHelp[mode]}</p>

      <div className="ws-form">
        {mode !== 'step' && (
          <label>{t.parts}
            <select value={code ? parts : 'click'} disabled={!code} onChange={(e) => setParts(e.target.value as Parts)}>
              <option value="all">{t.partsAll}</option>
              <option value="nobass">{t.partsNoBass}</option>
              <option value="bass">{t.partsBass}</option>
              <option value="click">{t.partsClick}</option>
            </select>
          </label>
        )}
        <label>{t.fromBar}
          <input type="number" inputMode="numeric" min={1} max={total} value={opts.from + 1}
            onChange={(e) => { const v = Math.round(Number(e.target.value)); if (v >= 1 && v <= total) setFrom(v - 1); }} />
        </label>
        <label>{t.length}
          <select value={len >= total ? 'all' : len} onChange={(e) => setLen(e.target.value === 'all' ? total : Number(e.target.value))}>
            {LENGTHS.filter((l) => l < total).map((l) => <option key={l} value={l}>{t.bars(l)}</option>)}
            <option value="all">{t.wholeTrack} ({total})</option>
          </select>
        </label>
        {mode !== 'step' && (
          <>
            <label>{t.speed}
              <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
                {SPEEDS.map((s) => <option key={s} value={s}>{Math.round(s * 100)} % ({Math.round(bpm * s)} bpm)</option>)}
              </select>
            </label>
            <label>{t.countIn}
              <select value={countIn} onChange={(e) => setCountIn(Number(e.target.value))}>
                <option value={0}>{t.none}</option>
                <option value={1}>{t.bars(1)}</option>
                <option value={2}>{t.bars(2)}</option>
              </select>
            </label>
            <label className="ws-check"><input type="checkbox" checked={click} onChange={(e) => setClick(e.target.checked)} /> {t.click}</label>
          </>
        )}
        {mode === 'listen' && (
          <label>{t.latency}
            <input type="number" inputMode="numeric" min={0} max={500} step={10} value={latency}
              onChange={(e) => { const v = Number(e.target.value); if (v >= 0 && v <= 500) setLatency(v); }} />
          </label>
        )}
      </div>
      {sections.length > 0 && (
        <div className="ws-seg">
          {sections.map((s, k) => {
            const end = sections[k + 1]?.bar ?? total;
            return <button key={`${s.bar}-${s.name}`} className={opts.from === s.bar ? 'on' : ''} onClick={() => { setFrom(s.bar); setLen(Math.max(1, end - s.bar)); }}>{s.name}</button>;
          })}
        </div>
      )}
      {mode === 'listen' && <p className="ws-dim ws-small">{t.latencyHelp}</p>}
      {!code && mode !== 'step' && <p className="ws-dim ws-small">{t.noPatch}</p>}
      {code && parts !== 'all' && parts !== 'click' && mode !== 'step' && <p className="ws-dim ws-small">{t.noBassTag}</p>}

      <div className="ws-transport">
        {busy
          ? <button onClick={stopAll} className="ws-play">{t.stop}</button>
          : <button onClick={onPlay} className="ws-play">{t.play}</button>}
        {mode === 'step' && stepping && <button onClick={() => { stepper.current?.restart(); setStepIndex(0); }}>{t.restart}</button>}
        {mode === 'step' && stepping && <span className="ws-barcount">{stepIndex >= stepTotal ? t.stepDone : t.stepAt(stepIndex + 1, stepTotal)}</span>}
        {(mode !== 'play') && busy && <span className="ws-barcount">{t.heard}: {heard !== undefined ? keyName(Math.round(heard), lang === 'fr') : '–'}</span>}
      </div>
      {error && <p className="ws-error">{error}</p>}
      {msg && <p className="ws-msg">{msg}</p>}
      {(mode === 'listen' || mode === 'step') && <p className="ws-dim ws-small">{t.micNote}</p>}

      {pos?.countdown !== undefined && <p className="ws-countdown">{t.countdown(pos.countdown)}</p>}
      <div className="ws-nownext">
        <NoteBox label={t.now} note={nowNote?.n} t={t} names={tuningNames} big />
        <NoteBox label={t.next} note={nextNote?.n} t={t} names={tuningNames} />
      </div>
      <div className="ws-tabview">
        {clock
          ? <TabView tab={msgTab} clock={clock} tones={tones} texts={{ tabWaiting: '', tabNone: t.noTab, tabStopped: '' }} />
          : <TabView tab={msgTab} bar={fixedBar ?? opts.from} tones={tones} texts={{ tabWaiting: '', tabNone: t.noTab, tabStopped: '' }} />}
      </div>
      <h3>{t.neck}</h3>
      <Neck names={tuningNames} now={nowNote?.n} next={nextNote?.n} maxFret={Math.max(12, ...loopNotes(notes, opts).map(({ n }) => n.fret + 1))} />

      {mode === 'listen' && summary && summary.total > 0 && (
        <div className="ws-score">
          <p><b>{t.score(summary.hits, summary.total)}</b></p>
          {summary.sections.length > 1 && <p className="ws-small">{summary.sections.map((s) => `${s.name} ${Math.round((s.hits / s.total) * 100)} %`).join(' · ')}</p>}
          {summary.missedBars.length > 0 && (
            <>
              <p className="ws-small">{t.missed}</p>
              <div className="ws-seg">
                {summary.missedBars.slice(0, 16).map((b) => <button key={b} onClick={() => { stopAll(); setFrom(b); setLen(1); }}>{t.loopBar(b + 1)}</button>)}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function NoteBox({ label, note, t, names, big }: { label: string; note?: TabNote; t: ReturnType<typeof ptexts>; names: string[]; big?: boolean }) {
  return (
    <div className={`ws-notebox${big ? ' big' : ''}`}>
      <span className="ws-dim ws-small">{label}</span>
      {note ? (
        <>
          <b>{note.fret}</b>
          <span>{t.string(names[note.string] ?? String(note.string + 1))} · {t.fret(note.fret)}</span>
          {note.finger > 0 && <span className="ws-dim ws-small">{t.finger(note.finger)}</span>}
        </>
      ) : <b>–</b>}
    </div>
  );
}

/** The neck, highest string on top (as the player looks down): now filled with its finger, next outlined. */
function Neck({ names, now, next, maxFret }: { names: string[]; now?: TabNote; next?: TabNote; maxFret: number }) {
  const frets = Math.min(24, maxFret);
  const W = 30, H = 22, L = 22;
  const x = (f: number) => (f === 0 ? L / 2 : L + (f - 0.5) * W);
  const y = (s: number) => 10 + (names.length - 1 - s) * H;
  const width = L + frets * W + 4;
  const height = 20 + (names.length - 1) * H;
  return (
    <div className="ws-neck">
      <svg viewBox={`0 0 ${width} ${height}`} style={{ minWidth: `${Math.min(width, 900)}px` }}>
        {Array.from({ length: frets + 1 }, (_, f) => (
          <line key={f} x1={L + f * W} x2={L + f * W} y1={y(names.length - 1)} y2={y(0)} className={f === 0 ? 'neck-nut' : 'neck-fret'} />
        ))}
        {[3, 5, 7, 9, 15, 17, 19, 21].filter((f) => f <= frets).map((f) => <circle key={f} cx={x(f)} cy={height / 2} r={3} className="neck-dot" />)}
        {[12, 24].filter((f) => f <= frets).map((f) => <g key={f}><circle cx={x(f)} cy={height / 2 - H / 2} r={3} className="neck-dot" /><circle cx={x(f)} cy={height / 2 + H / 2} r={3} className="neck-dot" /></g>)}
        {names.map((n, s) => (
          <g key={s}>
            <line x1={L} x2={width - 4} y1={y(s)} y2={y(s)} className="neck-string" style={{ strokeWidth: 1 + (names.length - 1 - s) * 0.5 }} />
            <text x={2} y={y(s) + 4} className="neck-name">{n}</text>
          </g>
        ))}
        {next && next.fret <= frets && <circle cx={x(next.fret)} cy={y(next.string)} r={9} className="neck-next" />}
        {now && now.fret <= frets && (
          <g>
            <circle cx={x(now.fret)} cy={y(now.string)} r={10} className="neck-now" />
            <text x={x(now.fret)} y={y(now.string) + 4} className="neck-finger">{now.fret === 0 ? '0' : now.finger || ''}</text>
          </g>
        )}
      </svg>
    </div>
  );
}
