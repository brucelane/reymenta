// The Jam on the phone (2026-11-20, studies/reymenta-jam.md): pick a track of the organiser's Live template, then
// play it: pads over the scale (coloured by degree, the root in the track's colour), drum pads, the clips the
// organiser allows, knobs (an XY pad for an effect with two). Everything goes to the audience server (src/jam),
// which plays it in Live on Link's beat. A beat pulse at the top (Link's beat, or the jam's tempo without Link).
import { useEffect, useRef, useState } from 'react';
import type { JamBeatMsg, JamStateMsg } from '../../../src/room/protocol';
import type { Lang } from '../i18n';
import './jam.css';

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_FR = ['Do', 'Do#', 'Ré', 'Ré#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
const MODE_NAMES: Record<string, { fr: string; en: string }> = {
  major: { fr: 'majeur', en: 'major' }, minor: { fr: 'mineur', en: 'minor' }, dorian: { fr: 'dorien', en: 'dorian' },
  phrygian: { fr: 'phrygien', en: 'phrygian' }, lydian: { fr: 'lydien', en: 'lydian' }, mixolydian: { fr: 'mixolydien', en: 'mixolydian' },
  locrian: { fr: 'locrien', en: 'locrian' }, harmonicMinor: { fr: 'mineur harmonique', en: 'harmonic minor' },
  melodicMinor: { fr: 'mineur mélodique', en: 'melodic minor' }, majorPenta: { fr: 'penta majeure', en: 'major pentatonic' },
  minorPenta: { fr: 'penta mineure', en: 'minor pentatonic' }, blues: { fr: 'blues', en: 'blues' },
};
const TEXTS = {
  fr: {
    pick: 'Choisissez votre piste', change: 'Changer de piste', closed: "Le jam n'est pas encore ouvert : il commence quand l'organisateur le lance.",
    none: "Pas de jam sur ce serveur.", players: (n: number) => (n ? `${n} joueur${n > 1 ? 's' : ''}` : 'libre'),
    kinds: { notes: 'instrument', drums: 'batterie', fx: 'effet' } as Record<string, string>,
    clips: 'Lancer', knobs: 'Réglages', noLink: 'sans Link : tempo du jam', link: 'Link', leave: 'Quitter le jam',
    hint: 'Les notes partent sur le temps : jouez, tout reste en place.',
  },
  en: {
    pick: 'Pick your track', change: 'Change track', closed: "The jam isn't open yet: it starts when the organiser starts it.",
    none: 'No jam on this server.', players: (n: number) => (n ? `${n} player${n > 1 ? 's' : ''}` : 'free'),
    kinds: { notes: 'instrument', drums: 'drums', fx: 'effect' } as Record<string, string>,
    clips: 'Launch', knobs: 'Controls', noLink: 'no Link: the jam’s tempo', link: 'Link', leave: 'Leave the jam',
    hint: 'Notes land on the beat: play, everything stays in time.',
  },
};

type Send = (m: unknown) => void;

/** A degree's colour: the root in the track's colour, the others around the hue circle. */
function degreeColor(degree: number, count: number, trackColor: string): string {
  if (degree === 0) return trackColor;
  return `hsl(${Math.round((degree / count) * 300 + 30)} 65% 52%)`;
}

export default function JamView({ lang, state, beat, send, onLeave }: {
  lang: Lang; state?: JamStateMsg; beat?: { msg: JamBeatMsg; at: number }; send: Send; onLeave: () => void;
}) {
  const t = TEXTS[lang];
  const names = lang === 'fr' ? NAMES_FR : NAMES;
  if (!state) return <p className="jam-msg">…</p>;
  if (!state.tracks.length) return <section className="jam"><p className="jam-msg">{t.none}</p><button onClick={onLeave}>{t.leave}</button></section>;
  const track = state.mine >= 0 ? state.tracks[state.mine] : undefined;
  const scale = `${names[state.root]} ${MODE_NAMES[state.mode]?.[lang] ?? state.mode}`;

  return (
    <section className="jam">
      <header className="jam-head">
        <b>{state.title}</b>
        <span className="jam-scale">{scale}</span>
        <Pulse beat={beat} />
        <span className="jam-dim">{state.link ? `${t.link} · ${Math.round(state.bpm)} bpm` : `${t.noLink} ${Math.round(state.bpm)} bpm`}</span>
      </header>
      {!state.on && <p className="jam-msg">{t.closed}</p>}
      {!track ? (
        <>
          <h2>{t.pick}</h2>
          <div className="jam-tracks">
            {state.tracks.map((tr, i) => (
              <button key={i} style={{ borderColor: tr.c }} onClick={() => send({ t: 'jt', k: i })}>
                <b style={{ color: tr.c }}>{tr.n}</b>
                <span className="jam-dim">{t.kinds[tr.k] ?? tr.k} · {t.players(tr.p)}</span>
              </button>
            ))}
          </div>
          <button className="jam-leave" onClick={onLeave}>{t.leave}</button>
        </>
      ) : (
        <>
          <div className="jam-trackbar">
            <b style={{ color: track.c }}>{track.n}</b>
            <span className="jam-dim">{t.players(track.p)}</span>
            <button onClick={() => send({ t: 'jt', k: -1 })}>{t.change}</button>
          </div>
          {track.k === 'notes' && <NotePads track={track} steps={state.steps} names={names} send={send} disabled={!state.on} />}
          {track.k === 'drums' && track.pads.length > 0 && <DrumPads track={track} send={send} disabled={!state.on} />}
          {track.clips.length > 0 && (
            <div className="jam-clips">
              <span className="jam-dim">{t.clips}</span>
              {track.clips.map(([i, name]) => <ClipButton key={i} name={name} color={track.c} disabled={!state.on} onLaunch={() => send({ t: 'jc', c: i })} />)}
            </div>
          )}
          {track.knobs.length > 0 && (
            <div className="jam-knobs">
              <span className="jam-dim">{t.knobs}</span>
              {track.k === 'fx' && track.knobs.length >= 2
                ? <XYPad names={[track.knobs[0], track.knobs[1]]} values={[track.kv[0] ?? 0.5, track.kv[1] ?? 0.5]} color={track.c} send={send} disabled={!state.on} />
                : null}
              {track.knobs.map((name, k) => (track.k === 'fx' && track.knobs.length >= 2 && k < 2 ? null : (
                <Knob key={`${state.mine}-${k}`} name={name} initial={track.kv[k] ?? 0.5} onChange={(v) => send({ t: 'jk', k, v })} disabled={!state.on} />
              )))}
            </div>
          )}
          <p className="jam-dim">{t.hint}</p>
        </>
      )}
    </section>
  );
}

/** Four dots, the beat lit (extrapolated between the server's beats). */
function Pulse({ beat }: { beat?: { msg: JamBeatMsg; at: number } }) {
  const [, setFrame] = useState(0);
  useEffect(() => {
    let raf = 0, last = 0;
    const tick = (now: number) => { if (now - last > 40) { last = now; setFrame((f) => f + 1); } raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  if (!beat) return <span className="jam-pulse" />;
  const b = beat.msg.b + (beat.msg.p ? ((performance.now() - beat.at) / 60000) * beat.msg.bpm : 0);
  const n = ((Math.floor(b) % 4) + 4) % 4;
  const frac = b - Math.floor(b);
  return (
    <span className="jam-pulse" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => <i key={i} className={i === n ? (frac < 0.25 ? 'hit' : 'on') : ''} />)}
    </span>
  );
}

/** Pads with multi-touch: each finger holds its pad until it lifts (pointer capture per finger). */
function usePads(send: Send, disabled: boolean) {
  const fingers = useRef(new Map<number, number>()); // pointerId -> pad
  const [down, setDown] = useState<Set<number>>(new Set());
  const press = (pad: number, e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = e.currentTarget.getBoundingClientRect();
    const v = Math.round((0.55 + 0.45 * (1 - (e.clientY - r.top) / r.height)) * 100) / 100; // higher on the pad = louder
    fingers.current.set(e.pointerId, pad);
    send({ t: 'jn', p: pad, on: 1, v: Math.min(1, Math.max(0.3, v)) });
    navigator.vibrate?.(8);
    setDown((d) => new Set(d).add(pad));
  };
  const lift = (e: React.PointerEvent<HTMLButtonElement>) => {
    const pad = fingers.current.get(e.pointerId);
    if (pad === undefined) return;
    fingers.current.delete(e.pointerId);
    if (![...fingers.current.values()].includes(pad)) {
      send({ t: 'jn', p: pad, on: 0 });
      setDown((d) => { const n = new Set(d); n.delete(pad); return n; });
    }
  };
  // leaving the screen: every held pad lifts
  useEffect(() => () => { for (const pad of new Set(fingers.current.values())) send({ t: 'jn', p: pad, on: 0 }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const props = (pad: number) => ({
    onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => press(pad, e),
    onPointerUp: lift, onPointerCancel: lift, onLostPointerCapture: lift,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
  return { down, props };
}

function NotePads({ track, steps, names, send, disabled }: {
  track: JamStateMsg['tracks'][number]; steps: number[]; names: string[]; send: Send; disabled: boolean;
}) {
  const { down, props } = usePads(send, disabled);
  const n = steps.length || 7;
  const count = track.pads.length;
  const rows: number[][] = [];
  for (let start = 0; start < count; start += n) rows.push(Array.from({ length: Math.min(n, count - start) }, (_, i) => start + i));
  rows.reverse(); // high notes on top
  return (
    <div className="jam-pads" style={{ ['--cols' as string]: n }}>
      {rows.map((row, r) => (
        <div key={r} className="jam-row">
          {row.map((pad) => {
            const degree = pad % n;
            const key = track.base + Math.floor(pad / n) * 12 + (steps[degree] ?? 0);
            return (
              <button key={pad} className={`jam-pad${down.has(pad) ? ' down' : ''}${degree === 0 ? ' root' : ''}`} disabled={disabled}
                style={{ ['--pad' as string]: degreeColor(degree, n, track.c) }} {...props(pad)}>
                {names[key % 12]}<small>{Math.floor(key / 12) - 1}</small>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function DrumPads({ track, send, disabled }: { track: JamStateMsg['tracks'][number]; send: Send; disabled: boolean }) {
  const { down, props } = usePads(send, disabled);
  return (
    <div className="jam-drums">
      {track.pads.map((name, pad) => (
        <button key={pad} className={`jam-pad${down.has(pad) ? ' down' : ''}`} disabled={disabled}
          style={{ ['--pad' as string]: degreeColor(pad, track.pads.length + 1, track.c) }} {...props(pad)}>{name}</button>
      ))}
    </div>
  );
}

function ClipButton({ name, color, disabled, onLaunch }: { name: string; color: string; disabled: boolean; onLaunch: () => void }) {
  const [wait, setWait] = useState(false);
  return (
    <button className="jam-clip" style={{ borderColor: color }} disabled={disabled || wait}
      onClick={() => { onLaunch(); setWait(true); navigator.vibrate?.(20); window.setTimeout(() => setWait(false), 2000); }}>▶ {name}</button>
  );
}

/** Sends at most 8 times a second while moving, and the last value when it stops. */
function useThrottled(f: (v: number) => void) {
  const last = useRef(0);
  const pending = useRef<number | undefined>(undefined);
  const timer = useRef<number | undefined>(undefined);
  return (v: number) => {
    const now = performance.now();
    if (now - last.current >= 125) { last.current = now; f(v); return; }
    pending.current = v;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { if (pending.current !== undefined) { last.current = performance.now(); f(pending.current); pending.current = undefined; } }, 130);
  };
}

function Knob({ name, initial, onChange, disabled }: { name: string; initial: number; onChange: (v: number) => void; disabled: boolean }) {
  const [v, setV] = useState(initial);
  const send = useThrottled(onChange);
  return (
    <label className="jam-knob">
      <span>{name}</span>
      <input type="range" min={0} max={1} step={0.01} value={v} disabled={disabled}
        onChange={(e) => { const x = Number(e.target.value); setV(x); send(x); }} />
    </label>
  );
}

function XYPad({ names, values, color, send, disabled }: { names: [string, string]; values: [number, number]; color: string; send: Send; disabled: boolean }) {
  const [xy, setXY] = useState(values);
  const sx = useThrottled((v) => send({ t: 'jk', k: 0, v }));
  const sy = useThrottled((v) => send({ t: 'jk', k: 1, v }));
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * 100) / 100;
    const y = Math.round(Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)) * 100) / 100;
    if (x !== xy[0]) sx(x);
    if (y !== xy[1]) sy(y);
    setXY([x, y]);
  };
  return (
    <div className="jam-xy" style={{ ['--pad' as string]: color }}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); move(e); }}
      onPointerMove={(e) => { if (e.buttons || e.pointerType === 'touch') move(e); }}>
      <span className="jam-xy-x">{names[0]} →</span>
      <span className="jam-xy-y">↑ {names[1]}</span>
      <i style={{ left: `${xy[0] * 100}%`, top: `${(1 - xy[1]) * 100}%` }} />
    </div>
  );
}
