import { useEffect, useRef, useState } from 'react';
import { EMOJIS, type ServerMessage } from '../../src/room/protocol';
import { connect, isNativeApp, phoneId, savedServer, saveServer, type Connection, type Status } from './connection';
import { discoverServer } from './discovery';
import { initialLang, saveLang, texts, type Lang } from './i18n';
import { requestMotionPermission, startMotion, type Motion } from './sensors';

interface Me { slot: number; x: number; y: number; count: number; name: { fr: string; en: string }; hue: number }

export function App() {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState<Status>('closed');
  const [me, setMe] = useState<Me | undefined>();
  const [full, setFull] = useState(false);
  const [sensors, setSensors] = useState(true);
  const conn = useRef<Connection | undefined>(undefined);
  const motion = useRef<Motion>({ tx: 0, ty: 0, sh: 0 });
  const touch = useRef({ to: 0 as 0 | 1, px: 0.5, py: 0.5 });
  const [, redraw] = useState(0);
  const t = texts(lang);

  const switchLang = (l: Lang) => { setLang(l); saveLang(l); };

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
        } else if (msg.t === 'place') {
          setMe((m) => (m ? { ...m, slot: msg.slot, x: msg.x, y: msg.y, count: msg.count } : m));
        } else if (msg.t === 'full') {
          setFull(true);
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

  const langSwitch = (
    <div className="lang">
      <button className={lang === 'fr' ? 'on' : ''} onClick={() => switchLang('fr')}>FR</button>
      <button className={lang === 'en' ? 'on' : ''} onClick={() => switchLang('en')}>EN</button>
    </div>
  );

  if (!joined) {
    return (
      <main className="join">
        {langSwitch}
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
      {langSwitch}
      <header>
        {me ? <><span className="youare">{t.youAre}</span> <b className="name">{me.name[lang]}</b><span className="place">{t.place(me.slot, me.count)}</span></> : <span>{waiting ? t.waiting : t.joining}</span>}
        {status !== 'open' && me && <span className="warn">{t.reconnecting}</span>}
      </header>
      {full && <p className="warn">{t.full}</p>}
      {!sensors && <p className="warn">{t.sensorsOff}</p>}
      <div
        className="pad"
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
      </div>
      <nav className="emojis">
        {EMOJIS.map((e, i) => (
          <button key={e} onClick={() => { conn.current?.send({ t: 'emo', e: i }); navigator.vibrate?.(15); }}>{e}</button>
        ))}
      </nav>
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
