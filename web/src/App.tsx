import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { EMOJIS, type JamBeatMsg, type JamStateMsg, type PhoneMessage, type ServerMessage, type TabMsg, type ShaderMsg } from '../../src/room/protocol';
import { TabView, type ClockAt } from './TabView';
import { connect, fromShowLink, gateOpensAt, isNativeApp, phoneId, savedServer, saveServer, saveShowCode, showCode, type Connection, type Status } from './connection';
import { discoverServer } from './discovery';
import { initialLang, saveLang, texts, type Lang } from './i18n';
import { debugSensors, demoMotion, requestMotionPermission, startMotion, type Motion } from './sensors';

// the Workshop (studies/reymenta-workshop.md step 3): loaded only when opened, so the Show page stays small
const Workshop = lazy(() => import('./workshop/Workshop'));
// the tuner (2026-11-20): its own chunk, loaded when opened
const Tuner = lazy(() => import('./tuner/Tuner'));
// the Jam (2026-11-20, studies/reymenta-jam.md): its own chunk
const JamView = lazy(() => import('./jam/JamView'));
const VisBackground = lazy(() => import('./jam/VisBackground'));
type AppMode = 'show' | 'workshop';
const MODE_KEY = 'reymenta:mode';
function initialMode(): AppMode {
  if (fromShowLink || new URLSearchParams(location.search).has('room')) return 'show';
  try { return localStorage.getItem(MODE_KEY) === 'workshop' ? 'workshop' : 'show'; } catch { return 'show'; }
}

interface Me { slot: number; x: number; y: number; count: number; name: { fr: string; en: string }; hue: number }

export function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState<Status>('closed');
  const [me, setMe] = useState<Me | undefined>();
  const [full, setFull] = useState(false);
  const [sensors, setSensors] = useState(true);
  const [code, setCode] = useState(showCode);
  // the emoji row: hidden until the track playing opens it (the server says so, 2026-11-17); ?demo always shows it
  const [emojis, setEmojis] = useState(demoMotion);
  // the bass tab view (2026-11-19): the server sends the playing track's tab and clock only while it's open
  const [tabOpen, setTabOpen] = useState(false);
  const [tunerOpen, setTunerOpen] = useState(false);
  // the Jam: chosen on the start screen (the phone joins the room, then opens the Jam screen)
  const [jamMode, setJamMode] = useState(false);
  const jamModeRef = useRef(false);
  const [jamState, setJamState] = useState<JamStateMsg | undefined>();
  const [jamBeat, setJamBeat] = useState<{ msg: JamBeatMsg; at: number } | undefined>();
  const leaveJam = () => { jamModeRef.current = false; setJamMode(false); conn.current?.send({ t: 'jam', on: false }); conn.current?.send({ t: 'vis', on: false }); };
  const tabOpenRef = useRef(false);
  const [tab, setTab] = useState<TabMsg | undefined>();
  const [clock, setClock] = useState<ClockAt | undefined>();
  // the show's visuals behind the jam (2026-11-21): the playing folder's shader, rendered here (jam/VisBackground.tsx)
  const [visShader, setVisShader] = useState<ShaderMsg | undefined>();
  const toggleTab = () => {
    const on = !tabOpenRef.current;
    tabOpenRef.current = on;
    setTabOpen(on);
    conn.current?.send({ t: 'tab', on });
  };
  const conn = useRef<Connection | undefined>(undefined);
  const motion = useRef<Motion>({ tx: 0, ty: 0, sh: 0 });
  const touch = useRef({ to: 0 as 0 | 1, px: 0.5, py: 0.5 });
  const [, redraw] = useState(0);
  const t = texts(lang);

  const switchLang = (l: Lang) => { setLang(l); saveLang(l); };
  // Show (the audience page) or Workshop, the last choice remembered
  const [mode, setModeState] = useState<AppMode>(initialMode);
  const setMode = (m: AppMode) => { setModeState(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* blocked */ } };

  // connected but no welcome after a few seconds: the show (the audience server) isn't running yet
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    if (status !== 'open' || me) { setWaiting(false); return; }
    const timer = window.setTimeout(() => setWaiting(true), 4000);
    return () => window.clearTimeout(timer);
  }, [status, me]);

  // the app finds the audience server by itself (last address, mDNS, Wi-Fi scan) unless one was typed
  const [server, setServer] = useState(savedServer);
  const [search, setSearch] = useState<'' | 'searching' | 'found' | 'notfound'>('');
  useEffect(() => {
    if (!isNativeApp || savedServer()) return;
    setSearch('searching');
    discoverServer().then((found) => {
      if (found && !savedServer()) { saveServer(found); setServer(found); setSearch('found'); }
      else setSearch(found ? 'found' : 'notfound');
    });
  }, []);

  const join = async () => {
    setJoined(true);
    const ok = await requestMotionPermission(); // must run inside the tap
    setSensors(ok);
    const stopMotion = ok ? startMotion(motion.current) : () => {};
    const id = phoneId();
    conn.current = connect(
      () => ({ t: 'hello', id, lang }),
      (msg: ServerMessage) => {
        if (msg.t === 'welcome') {
          setFull(false);
          setMe((m) => ({ slot: msg.slot, x: msg.x, y: msg.y, count: m?.count ?? msg.slot + 1, name: msg.name, hue: msg.hue }));
          // after a reconnect the server has forgotten the open tab view
          if (tabOpenRef.current) conn.current?.send({ t: 'tab', on: true });
          if (jamModeRef.current) { conn.current?.send({ t: 'jam', on: true }); conn.current?.send({ t: 'vis', on: true }); }
        } else if (msg.t === 'place') {
          setMe((m) => (m ? { ...m, slot: msg.slot, x: msg.x, y: msg.y, count: msg.count } : m));
        } else if (msg.t === 'full') {
          setFull(true);
        } else if (msg.t === 'emojis') {
          setEmojis(msg.on);
        } else if (msg.t === 'tab') {
          setTab(msg);
        } else if (msg.t === 'shader') {
          setVisShader(msg);
        } else if (msg.t === 'clock') {
          setClock({ msg, at: performance.now() });
        } else if (msg.t === 'jam') {
          setJamState(msg);
        } else if (msg.t === 'jbeat') {
          setJamBeat({ msg, at: performance.now() });
        }
      },
      setStatus,
    );
    // keep the screen on while playing (released by the browser when the page is hidden)
    try { await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<unknown> } }).wakeLock?.request('screen'); } catch { /* not supported */ }
    window.addEventListener('pagehide', () => { stopMotion(); conn.current?.close(); }, { once: true });
  };

  // send the inputs that changed, at most 10 times a second
  useEffect(() => {
    if (!joined) return;
    let last = { tx: 9, ty: 9, sh: 9, to: 9, px: 9, py: 9 };
    const r = (v: number) => Math.round(v * 100) / 100;
    const timer = window.setInterval(() => {
      const now = { tx: r(motion.current.tx), ty: r(motion.current.ty), sh: r(motion.current.sh), ...touch.current };
      const changed = Math.abs(now.tx - last.tx) > 0.02 || Math.abs(now.ty - last.ty) > 0.02 || Math.abs(now.sh - last.sh) > 0.03
        || now.to !== last.to || (now.to === 1 && (Math.abs(now.px - last.px) > 0.01 || Math.abs(now.py - last.py) > 0.01));
      if (!changed) return;
      conn.current?.send({ t: 'in', tx: now.tx, ty: now.ty, sh: now.sh, to: now.to, ...(now.to ? { px: r(now.px), py: r(now.py) } : {}) });
      last = now;
      redraw((n) => n + 1);
    }, 100);
    return () => window.clearInterval(timer);
  }, [joined]);

  const onPointer = (e: React.PointerEvent<HTMLDivElement>, down: boolean) => {
    const rect = e.currentTarget.getBoundingClientRect();
    touch.current = {
      to: down ? 1 : 0,
      px: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      py: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  // the Android app on Google Play: on the web page only (not inside the app, not on iPhones)
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const playBadge = !isNativeApp && !isIos && !demoMotion && (
    <a className="play-badge" href="https://play.google.com/store/apps/details?id=com.videodromm.reymenta" target="_blank" rel="noreferrer">
      <span aria-hidden="true">▶</span> {t.googlePlay}
    </a>
  );

  const langSwitch = (
    <div className="lang">
      <button className={lang === 'fr' ? 'on' : ''} onClick={() => switchLang('fr')}>FR</button>
      <button className={lang === 'en' ? 'on' : ''} onClick={() => switchLang('en')}>EN</button>
    </div>
  );

  if (!joined && mode === 'workshop') {
    return (
      <Suspense fallback={<main className="join"><p className="tagline">…</p></main>}>
        <Workshop lang={lang} langSwitch={langSwitch} onShow={() => setMode('show')} />
      </Suspense>
    );
  }

  if (!joined) {
    return (
      <main className="join">
        {playBadge}{langSwitch}
        <h1><img className="logo" src="./logo.png" alt="Reymenta" /></h1>
        <p className="tagline">{t.tagline}</p>
        {isNativeApp && (
          <label className="server">
            {t.server}
            <input value={server} placeholder="192.168.1.54:5191" inputMode="url"
              onChange={(e) => { setServer(e.target.value); saveServer(e.target.value); }} />
            {search && <span className="search">{t.search[search]}</span>}
          </label>
        )}
        <button className="big" onClick={join}>{t.join}</button>
        <button className="workshop-btn jam-btn" onClick={() => { jamModeRef.current = true; setJamMode(true); void join(); }}>{t.jam}</button>
        <button className="workshop-btn" onClick={() => setMode('workshop')}>{t.workshop}</button>
        <p className="small">{t.privacy}</p>
        <p className="small">
          <a href="https://assets.batchass.fr/reymenta/privacy.html" target="_blank" rel="noreferrer">{t.privacyLink}</a>
          {' · '}v{__APP_VERSION__}
        </p>
      </main>
    );
  }

  const hue = me?.hue ?? 220;
  const m = motion.current;
  return (
    <main className="play" style={{ ['--hue' as string]: hue }}>
      {playBadge}{langSwitch}
      <header>
        {me ? <><span className="youare">{t.youAre}</span> <b className="name">{me.name[lang]}</b><span className="place">{t.place(me.slot, me.count)}</span></> : <span>{waiting ? t.waiting : t.joining}</span>}
        {status !== 'open' && me && <span className="warn">{t.reconnecting}</span>}
        {me && <button className={`tab-toggle${tabOpen ? ' on' : ''}`} onClick={toggleTab}>{t.tab}</button>}
        {me && <button className={`tab-toggle${tunerOpen ? ' on' : ''}`} onClick={() => setTunerOpen((o) => !o)}>{t.tuner}</button>}
      </header>
      {tunerOpen && <Suspense fallback={null}><Tuner lang={lang} onClose={() => setTunerOpen(false)} /></Suspense>}
      {full && <p className="warn">{t.full}</p>}
      {status === 'gate-closed' && !me && (
        <p className="warn">{gateOpensAt ? t.gateOpensAt(new Date(gateOpensAt).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })) : t.gateClosed}</p>
      )}
      {status === 'gate-captcha' && <p className="warn">{t.gateCaptcha}</p>}
      {/* Cloudflare Turnstile's checkbox, shown only when it needs the person (web/src/turnstile.ts) */}
      <div id="cf-turnstile-slot" className="turnstile" />
      {status === 'gate-code' && (
        <form className="code" onSubmit={(e) => { e.preventDefault(); saveShowCode(code); conn.current?.retryNow(); }}>
          <label>{t.gateCode}
            <input value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={12} inputMode="numeric" />
          </label>
          <button type="submit">{t.codeOk}</button>
        </form>
      )}
      {!sensors && <p className="warn">{t.sensorsOff}</p>}
      {debugSensors && <p className="small">sensor {m.src ?? '?'} · tilt {m.tx.toFixed(2)} {m.ty.toFixed(2)} · shake {m.sh.toFixed(2)}</p>}
      {jamMode && me && <Suspense fallback={null}><VisBackground shader={visShader} clock={clock} hue={hue} /></Suspense>}
      {jamMode && me && (
        <Suspense fallback={<p className="small">…</p>}>
          <JamView lang={lang} state={jamState} beat={jamBeat} send={(msg) => conn.current?.send(msg as PhoneMessage)} onLeave={leaveJam} />
        </Suspense>
      )}
      {tabOpen && <TabView tab={tab} clock={clock} texts={t} />}
      {!jamMode && <div
        className={`pad${tabOpen ? ' small-pad' : ''}`}
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onPointer(e, true); }}
        onPointerMove={(e) => { if (touch.current.to) onPointer(e, true); }}
        onPointerUp={(e) => onPointer(e, false)}
        onPointerCancel={(e) => onPointer(e, false)}
      >
        {me && <MiniRoom me={me} />}
        <div
          className="dot"
          style={{
            left: `${50 + m.tx * 40}%`, top: `${50 + m.ty * 40}%`,
            transform: `translate(-50%, -50%) scale(${1 + m.sh * 1.5 + (touch.current.to ? 0.4 : 0)})`,
          }}
        />
        <p className="hint">{t.hint}</p>
      </div>}
      {emojis && <nav className="emojis">
        {EMOJIS.map((e, i) => (
          <button key={e} onClick={() => { conn.current?.send({ t: 'emo', e: i }); navigator.vibrate?.(15); }}>{e}</button>
        ))}
      </nav>}
    </main>
  );
}

/** The room in miniature: every place as a small dot, mine bigger, in my colour. */
function MiniRoom({ me }: { me: Me }) {
  return (
    <div className="mini">
      <div className="mine" style={{ left: `${me.x * 100}%`, top: `${me.y * 100}%` }} />
    </div>
  );
}
