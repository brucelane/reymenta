// The online Jam's screen (2026-11-26): pick or create a room, then play in one of three roles:
// - Music: the show's JamView (pads, knobs), played by this page's synth with everyone in the room;
// - Visuals: Hydra code for the room's visuals, shown behind everyone's screen and driven by the room's notes;
// - Strudel: a Strudel part (typed, or built in strudel-flow and sent here with its "Send to jam" button), played by
//   every page on the room's shared bar line.
// Other players' Hydra and Strudel code runs only inside <iframe sandbox="allow-scripts"> pages (web/public/sandbox):
// an opaque origin that can't read this page, its storage or its connection.
// The room's logic is onlineRoom.ts; the address comes from /api/jamjoin (api/jamjoin). Azure Web PubSub's JSON
// subprotocol: joinGroup, then sendToGroup (noEcho) and "message" events from the group.
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { nameFor } from '../../../../src/room/names';
import { isNativeApp } from '../../connection';
import { turnstileToken } from '../../turnstile';
import type { Lang } from '../../i18n';
import { DEFAULT_FLOW_URL } from '../../workshop/grooves';
import {
  cleanRoom, MAX_CODE, MAX_PLAYERS, newPlayerId, newRoomCode, OnlineRoom, parsePeerMessage, PRESENCE_MS, ROOM_RE, toNextBar, toWire,
  type PeerMessage, type Role,
} from './onlineRoom';
import { hydraStarter, stripTempo, strudelStarter } from './starters';
import { JamSynth } from './synth';
import type { JamBeatMsg, JamStateMsg } from '../../../../src/room/protocol';
import './online.css';

const JamView = lazy(() => import('../JamView'));

const BASE = isNativeApp ? 'https://live.videodromm.com' : '';
const API = `${BASE}/api/jamjoin`;
const ROOM_KEY = 'reymenta:jamroom';
/** strudel-flow's "Send to jam" is accepted from these origins only */
const FLOW_ORIGINS = [new URL(DEFAULT_FLOW_URL).origin, 'http://localhost:5174'];

const TEXTS = {
  fr: {
    title: 'Jam en ligne',
    intro: `Jouez à plusieurs depuis chez vous : jusqu'à ${MAX_PLAYERS} personnes par salle, une heure par session. Chacun choisit : la musique (pads), les visuels (Hydra) ou une partie Strudel, et entend toute la salle (montez le son).`,
    room: 'Code de la salle', create: 'Nouvelle salle', join: (r: string) => `Entrer dans la salle ${r}`,
    share: 'Invitez vos amis avec ce lien :', copy: 'Copier le lien', copied: 'Lien copié',
    connecting: 'Connexion…', full: `Cette salle est pleine (${MAX_PLAYERS} personnes) : essayez une autre salle.`,
    closed: 'Le Jam en ligne est fermé pendant la rencontre : ce soir, on joue dans la salle !',
    ended: 'Session terminée (une heure). Entrez à nouveau pour continuer.', error: 'Connexion impossible pour le moment. Réessayez dans un instant.',
    lost: 'Connexion perdue.', captcha: 'Vérification anti-robot refusée : réessayez.', tooMany: 'Trop de tentatives depuis votre connexion : réessayez dans quelques minutes.',
    muted: 'coupé (trop de messages)', players: 'Dans la salle', you: 'vous', alone: 'Seul pour le moment : partagez le lien.',
    home: 'Accueil', minutes: (m: number) => `encore ${m} min`,
    roles: { music: '🎹 Musique', visuals: '🌀 Visuels', strudel: '⌨ Strudel' } as Record<Role, string>,
    send: 'Envoyer à la salle', sent: 'Envoyé', wait: 'Attendez deux secondes', long: `Trop long (${MAX_CODE} caractères au plus)`,
    removePart: 'Retirer ma partie', flow: 'Ouvrir strudel-flow (les blocs)', flowHide: 'Fermer strudel-flow',
    yourCode: 'Votre partie (le code envoyé à la salle) :', drumsHint: 'Ici, chaque pad joue un son. Pour construire un groove de batterie avec des blocs :',
    flowHint: 'Construisez un groove avec les blocs, puis « Send to jam » dans le panneau du code : il arrive ici, prêt à envoyer.',
    flowGot: 'Code reçu de strudel-flow : vérifiez-le, puis « Envoyer à la salle ».',
    visualsOn: 'Visuels affichés', visualsOff: 'Visuels masqués',
    visualsHint: 'Votre code devient les visuels de toute la salle (le dernier envoyé gagne).',
    strudelHint: 'Votre partie joue chez tout le monde, calée sur la mesure de la salle. Les parties des autres s’ajoutent à la vôtre.',
    tapStrudel: 'Touchez 🔊 Strudel pour entendre les parties Strudel de la salle.',
    errorIn: 'Erreur dans le code :', nowVisuals: (n: string) => `Visuels : ${n}`, strudelParts: (n: number) => `${n} partie${n > 1 ? 's' : ''} Strudel`,
  },
  en: {
    title: 'Online jam',
    intro: `Play together from home: up to ${MAX_PLAYERS} people per room, one hour per session. Each picks: music (pads), visuals (Hydra) or a Strudel part, and hears the whole room (turn the sound up).`,
    room: 'Room code', create: 'New room', join: (r: string) => `Enter room ${r}`,
    share: 'Invite your friends with this link:', copy: 'Copy the link', copied: 'Link copied',
    connecting: 'Connecting…', full: `This room is full (${MAX_PLAYERS} people): try another room.`,
    closed: 'The online jam is closed during the meeting: tonight we play in the room!',
    ended: 'Session over (one hour). Enter again to go on.', error: "Can't connect right now. Try again in a moment.",
    lost: 'Connection lost.', captcha: 'Robot check refused: try again.', tooMany: 'Too many tries from your connection: try again in a few minutes.',
    muted: 'muted (too many messages)', players: 'In the room', you: 'you', alone: 'On your own for now: share the link.',
    home: 'Home', minutes: (m: number) => `${m} min left`,
    roles: { music: '🎹 Music', visuals: '🌀 Visuals', strudel: '⌨ Strudel' } as Record<Role, string>,
    send: 'Send to the room', sent: 'Sent', wait: 'Wait two seconds', long: `Too long (${MAX_CODE} characters at most)`,
    removePart: 'Remove my part', flow: 'Open strudel-flow (the blocks)', flowHide: 'Close strudel-flow',
    yourCode: 'Your part (the code sent to the room):', drumsHint: 'Here each pad plays one sound. To build a drum groove with blocks:',
    flowHint: 'Build a groove with the blocks, then "Send to jam" in the code panel: it lands here, ready to send.',
    flowGot: 'Code received from strudel-flow: check it, then "Send to the room".',
    visualsOn: 'Visuals shown', visualsOff: 'Visuals hidden',
    visualsHint: "Your code becomes the whole room's visuals (the latest sent wins).",
    strudelHint: "Your part plays for everyone, on the room's bar line. The others' parts add to yours.",
    tapStrudel: "Tap 🔊 Strudel to hear the room's Strudel parts.",
    errorIn: 'Error in the code:', nowVisuals: (n: string) => `Visuals: ${n}`, strudelParts: (n: number) => `${n} Strudel part${n > 1 ? 's' : ''}`,
  },
};

type Phase = 'lobby' | 'connecting' | 'playing' | 'full' | 'closed' | 'ended' | 'error' | 'lost' | 'captcha' | 'tooMany';

function initialRoom(): string {
  const q = cleanRoom(new URLSearchParams(location.search).get('room') ?? '');
  if (ROOM_RE.test(q)) return q;
  try { const s = cleanRoom(localStorage.getItem(ROOM_KEY) ?? ''); if (ROOM_RE.test(s)) return s; } catch { /* blocked */ }
  return '';
}

interface Session { room: OnlineRoom; ws: WebSocket; synth: JamSynth; timers: number[]; now: () => number }

export default function OnlineJam({ lang, langSwitch, onHome }: { lang: Lang; langSwitch: React.ReactNode; onHome: () => void }) {
  const t = TEXTS[lang];
  const [room, setRoom] = useState(initialRoom);
  const [phase, setPhase] = useState<Phase>('lobby');
  const [state, setState] = useState<JamStateMsg | undefined>();
  const [beat, setBeat] = useState<{ msg: JamBeatMsg; at: number } | undefined>();
  const [until, setUntil] = useState(0);
  const [copied, setCopied] = useState(false);
  const [role, setRoleState] = useState<Role>('music');
  const [hydraCode, setHydraCode] = useState(() => hydraStarter(lang));
  const [strudelCode, setStrudelCode] = useState(() => strudelStarter(lang));
  const [note, setNote] = useState('');
  const [hydraErr, setHydraErr] = useState('');
  const [strudelErr, setStrudelErr] = useState('');
  const [needTap, setNeedTap] = useState(false);
  const [visualsOn, setVisualsOn] = useState(true);
  // strudel-flow (the blocks) first in the Strudel tab: what players look for there (the user, 2026-11-26)
  const [flowOpen, setFlowOpen] = useState(true);
  const [, redraw] = useState(0);
  const session = useRef<Session | undefined>(undefined);
  const hydraFrame = useRef<HTMLIFrameElement>(null);
  const strudelFrame = useRef<HTMLIFrameElement>(null);
  const flowFrame = useRef<HTMLIFrameElement>(null);
  /** what the frames last got (sent again on their "ready") */
  const sentHydra = useRef('');
  const sentStrudel = useRef('');

  const link = `https://live.videodromm.com/?jam=online&room=${room}`;

  const end = (p: Phase) => {
    const s = session.current;
    session.current = undefined;
    if (s) {
      s.timers.forEach((id) => window.clearInterval(id));
      try { s.room.leave(); } catch { /* socket gone */ }
      window.setTimeout(() => { s.ws.close(); s.synth.close(); }, 300); // the goodbye and note offs leave first
    }
    sentHydra.current = '';
    sentStrudel.current = '';
    setState(undefined);
    setPhase(p);
  };
  useEffect(() => () => end('lobby'), []);

  /** the frames follow the room: the latest Hydra code, the Strudel parts on the next bar line ("h"/"s": send that
   *  frame its code again, after it loaded or was tapped) */
  const syncFrames = (force?: 'h' | 's') => {
    const s = session.current;
    if (!s) return;
    const h = s.room.hydra;
    const hKey = h ? `${h.id}:${h.v}` : '';
    if (h && hydraFrame.current?.contentWindow && (force === 'h' || hKey !== sentHydra.current)) {
      sentHydra.current = hKey;
      setHydraErr('');
      hydraFrame.current.contentWindow.postMessage({ type: 'code', code: h.code }, '*');
    }
    const program = s.room.strudelProgram();
    if (strudelFrame.current?.contentWindow && (force === 's' || program !== sentStrudel.current)) {
      sentStrudel.current = program;
      setStrudelErr('');
      const bpm = s.room.cfg.bpm;
      strudelFrame.current.contentWindow.postMessage(program
        ? { type: 'play', code: program, cps: bpm / 60 / 4, startIn: Math.round(toNextBar(s.now(), bpm)) }
        : { type: 'stop' }, '*');
    }
  };

  // the frames' and strudel-flow's messages: only from those frames (and strudel-flow's origin)
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const m = e.data as { type?: string; message?: string; code?: unknown } | null;
      if (!m || typeof m !== 'object') return;
      if (e.source && e.source === hydraFrame.current?.contentWindow) {
        if (m.type === 'ready') syncFrames('h');
        else if (m.type === 'error' && session.current?.room.hydra?.id === session.current?.room.me.id) setHydraErr(String(m.message ?? '').slice(0, 300));
      } else if (e.source && e.source === strudelFrame.current?.contentWindow) {
        if (m.type === 'ready' || m.type === 'tapped') { if (m.type === 'tapped') setNeedTap(false); syncFrames('s'); }
        else if (m.type === 'needtap') setNeedTap(true);
        else if (m.type === 'playing') setNeedTap(false);
        else if (m.type === 'error' && session.current?.room.strudel.has(session.current.room.me.id)) setStrudelErr(String(m.message ?? '').slice(0, 300));
      } else if (e.source && e.source === flowFrame.current?.contentWindow && FLOW_ORIGINS.includes(e.origin)) {
        if (m.type === 'strudel-flow-code' && typeof m.code === 'string' && m.code.length <= 20000) {
          setStrudelCode(stripTempo(m.code).slice(0, MAX_CODE));
          setNote(t.flowGot);
        }
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [lang]);

  const enter = async () => {
    if (!ROOM_RE.test(room) || session.current) return;
    try { localStorage.setItem(ROOM_KEY, room); } catch { /* blocked */ }
    setPhase('connecting');
    // inside the tap: browsers only start audio from a user gesture
    const id = newPlayerId();
    const nm = nameFor(id);
    let synth: JamSynth;
    try { synth = new JamSynth(110); await synth.resume(); } catch { setPhase('error'); return; }
    let body: { url?: string; group?: string; now?: number; until?: string; closed?: boolean; captcha?: boolean };
    let offset = 0;
    try {
      // Cloudflare Turnstile (when the site has it): most people see nothing, a checkbox only when it's unsure
      const tt = await turnstileToken(BASE);
      const t0 = Date.now();
      const res = await fetch(`${API}?id=${encodeURIComponent(id)}&room=${room}&t=${encodeURIComponent(tt)}`, { cache: 'no-store' });
      const t1 = Date.now();
      body = await res.json();
      if (res.status === 403 && body.closed) { synth.close(); setPhase('closed'); return; }
      if (res.status === 403 && body.captcha) { synth.close(); setPhase('captcha'); return; }
      if (res.status === 429) { synth.close(); setPhase('tooMany'); return; }
      if (!res.ok || !body.url || !body.group || typeof body.now !== 'number') throw new Error(String(res.status));
      offset = body.now - (t0 + t1) / 2; // the server's clock: one beat grid for the whole room
    } catch { synth.close(); setPhase('error'); return; }
    const now = () => Date.now() + offset;
    const group = body.group!;
    const ws = new WebSocket(body.url!, 'json.webpubsub.azure.v1');
    const send = (m: PeerMessage) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'sendToGroup', group, dataType: 'json', data: toWire(m), noEcho: true })); };
    const play = (msgs: Parameters<JamSynth['play']>[0], at: number) => {
      synth.play(msgs, synth.ctx.currentTime + (at - now()) / 1000);
      // the visuals feel the notes when they sound
      const ons = msgs.filter((x) => x.type === 'noteon');
      if (ons.length && hydraFrame.current?.contentWindow) {
        window.setTimeout(() => {
          for (const x of ons) hydraFrame.current?.contentWindow?.postMessage({ type: 'hit', ch: x.channel, note: x.note, v: (x.velocity ?? 100) / 127 }, '*');
        }, Math.max(0, at - now()));
      }
    };
    const r = new OnlineRoom({ id, name: nm[lang], hue: nm.hue }, now, send, play);
    const show = () => { setState(r.state()); syncFrames(); };
    const timers: number[] = [];
    session.current = { room: r, ws, synth, timers, now };
    const endAt = Date.parse(body.until ?? '') || Date.now() + 3600_000;
    setUntil(endAt);
    setRoleState('music');

    ws.onopen = () => ws.send(JSON.stringify({ type: 'joinGroup', group, ackId: 1 }));
    ws.onmessage = (e) => {
      let m: { type?: string; ackId?: number; success?: boolean; from?: string; fromUserId?: string; data?: unknown };
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.type === 'ack' && m.ackId === 1) {
        if (!m.success) { end('error'); return; }
        send(r.presence());
        // the others answer within a presence round; then the cap is checked
        window.setTimeout(() => {
          if (session.current?.room !== r) return;
          if (r.full) { end('full'); return; }
          setPhase('playing');
          show();
        }, 1500);
        return;
      }
      if (m.type === 'message' && m.from === 'group') {
        const p = parsePeerMessage(m.data, m.fromUserId, now());
        if (!p) return;
        // a newcomer's hello: my presence and my code at once, so it joins in the room's state
        if (p.t === 'p' && !r.peers.has(p.id)) r.greet();
        if (r.receive(p)) show();
      }
    };
    ws.onclose = () => { if (session.current?.ws === ws) end(Date.now() >= endAt - 5000 ? 'ended' : 'lost'); };
    timers.push(window.setInterval(() => r.tick(), 50));
    timers.push(window.setInterval(() => send(r.presence()), PRESENCE_MS));
    timers.push(window.setInterval(() => {
      setBeat({ msg: r.beat(), at: performance.now() });
      show();
      redraw((n) => n + 1);
      if (Date.now() >= endAt) end('ended');
    }, 1000));
  };

  const input = (msg: unknown) => { const s = session.current; if (s && s.room.input(msg)) setState(s.room.state()); };
  const pickRole = (r: Role) => { session.current?.room.setRole(r); setRoleState(r); setNote(''); };
  const share = (k: 'h' | 's', code: string) => {
    const s = session.current;
    if (!s) return;
    const res = s.room.shareCode(k, code);
    setNote(res === 'ok' ? t.sent : res === 'wait' ? t.wait : t.long);
    if (res === 'ok') { setState(s.room.state()); syncFrames(); }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { /* not allowed */ }
  };

  const s = session.current;
  if (phase === 'playing' && s && state) {
    const others = s.room.others();
    const left = Math.max(0, Math.ceil((until - Date.now()) / 60000));
    const hydraBy = s.room.hydra ? (s.room.hydra.id === s.room.me.id ? s.room.me.name : s.room.peers.get(s.room.hydra.id)?.name ?? '…') : '';
    const parts = s.room.strudel.size;
    return (
      <main className="play online-jam" style={{ ['--hue' as string]: s.room.me.hue }}>
        {/* the room's visuals, behind everything (others' code: sandboxed) */}
        {s.room.hydra && visualsOn && (
          <iframe ref={hydraFrame} className="oj-hydra" title="Hydra" src="sandbox/hydra.html" sandbox="allow-scripts" aria-hidden="true" tabIndex={-1} />
        )}
        {langSwitch}
        <header>
          <button className="tab-toggle home-btn" onClick={() => { end('lobby'); onHome(); }}>{t.home}</button>
          <span className="youare">{t.title}</span> <b className="name">{room}</b>
          <span className="place">{t.minutes(left)}</span>
        </header>
        <div className="oj-players">
          <span className="oj-dim">{t.players} :</span>
          <span className="oj-player" style={{ ['--h' as string]: s.room.me.hue }}>{s.room.me.name} ({t.you}) · {t.roles[role]}</span>
          {others.map((p) => (
            <span key={p.id} className="oj-player" style={{ ['--h' as string]: p.hue }}>
              {p.name} · {s.room.muted.has(p.id) ? t.muted : p.role === 'music' && p.track >= 0 ? state.tracks[p.track]?.n ?? '' : t.roles[p.role]}
            </span>
          ))}
          {!others.length && <span className="oj-dim">{t.alone}</span>}
        </div>
        <div className="oj-room-state">
          {hydraBy && <button className="tab-toggle" onClick={() => setVisualsOn((v) => !v)}>{visualsOn ? t.visualsOn : t.visualsOff} · {t.nowVisuals(hydraBy)}</button>}
          {parts > 0 && <span className="oj-dim">{t.strudelParts(parts)}</span>}
          {/* the room's Strudel parts play here (sandboxed); its button is the tap audio needs */}
          {parts > 0 && <iframe ref={strudelFrame} className="oj-strudel" title="Strudel" src="sandbox/strudel.html" sandbox="allow-scripts" allow="autoplay" />}
        </div>
        {parts > 0 && needTap && <p className="oj-dim">{t.tapStrudel}</p>}
        {!others.length && <ShareLink t={t} link={link} copied={copied} copy={copy} />}

        <nav className="oj-roles" role="tablist">
          {(['music', 'visuals', 'strudel'] as Role[]).map((r) => (
            <button key={r} role="tab" aria-selected={role === r} className={`tab-toggle${role === r ? ' on' : ''}`} onClick={() => pickRole(r)}>{t.roles[r]}</button>
          ))}
        </nav>

        {role === 'music' && (
          <Suspense fallback={<p className="small">…</p>}>
            <JamView lang={lang} state={state} beat={beat} send={input} onLeave={() => end('lobby')} />
          </Suspense>
        )}
        {role === 'visuals' && (
          <section className="oj-code">
            <p className="oj-dim">{t.visualsHint}</p>
            <textarea value={hydraCode} onChange={(e) => setHydraCode(e.target.value)} spellCheck={false} autoCapitalize="none" autoCorrect="off" rows={12} maxLength={MAX_CODE} />
            <div className="oj-buttons oj-left">
              <button className="big" onClick={() => { setVisualsOn(true); share('h', hydraCode); }}>{t.send}</button>
              {note && <span className="oj-dim">{note}</span>}
            </div>
            {hydraErr && <p className="warn">{t.errorIn} {hydraErr}</p>}
          </section>
        )}
        {role === 'music' && state.mine >= 0 && state.tracks[state.mine]?.k === 'drums' && (
          <p className="oj-dim">{t.drumsHint} <button className="tab-toggle" onClick={() => { pickRole('strudel'); setFlowOpen(true); }}>{t.roles.strudel}</button></p>
        )}
        {role === 'strudel' && (
          <section className="oj-code">
            <p className="oj-dim">{t.strudelHint}</p>
            {flowOpen && (
              <>
                <p className="oj-dim">{t.flowHint}</p>
                <iframe ref={flowFrame} className="oj-flow" title="strudel-flow" src={DEFAULT_FLOW_URL} allow="autoplay; clipboard-write" />
              </>
            )}
            <div className="oj-buttons oj-left">
              <button className="tab-toggle" onClick={() => setFlowOpen((o) => !o)}>{flowOpen ? t.flowHide : t.flow}</button>
            </div>
            <p className="oj-dim">{t.yourCode}</p>
            <textarea value={strudelCode} onChange={(e) => setStrudelCode(e.target.value)} spellCheck={false} autoCapitalize="none" autoCorrect="off" rows={flowOpen ? 6 : 10} maxLength={MAX_CODE} />
            <div className="oj-buttons oj-left">
              <button className="big" onClick={() => share('s', strudelCode)}>{t.send}</button>
              {s.room.strudel.has(s.room.me.id) && <button className="tab-toggle" onClick={() => share('s', '')}>{t.removePart}</button>}
              {note && <span className="oj-dim">{note}</span>}
            </div>
            {strudelErr && <p className="warn">{t.errorIn} {strudelErr}</p>}
          </section>
        )}
      </main>
    );
  }

  const msg = { full: t.full, closed: t.closed, ended: t.ended, error: t.error, lost: t.lost, captcha: t.captcha, tooMany: t.tooMany }[phase as 'full'];
  return (
    <main className="join online-jam">
      {langSwitch}
      <button className="tab-toggle home-btn oj-home" onClick={onHome}>{t.home}</button>
      <h1 className="oj-title">{t.title}</h1>
      <p className="tagline oj-intro">{t.intro}</p>
      {msg && <p className="warn">{msg}</p>}
      <label className="server">
        {t.room}
        <input value={room} maxLength={12} autoCapitalize="none" autoCorrect="off" spellCheck={false}
          onChange={(e) => setRoom(cleanRoom(e.target.value))} placeholder="abcde" />
      </label>
      <div className="oj-buttons">
        <button className="workshop-btn" onClick={() => setRoom(newRoomCode())}>{t.create}</button>
        <button className="big" disabled={!ROOM_RE.test(room) || phase === 'connecting'} onClick={() => void enter()}>
          {phase === 'connecting' ? t.connecting : t.join(room || '…')}
        </button>
      </div>
      {/* Cloudflare Turnstile's checkbox, shown only when it needs the person (web/src/turnstile.ts) */}
      <div id="cf-turnstile-slot" className="turnstile" />
      {ROOM_RE.test(room) && <ShareLink t={t} link={link} copied={copied} copy={copy} />}
    </main>
  );
}

function ShareLink({ t, link, copied, copy }: { t: (typeof TEXTS)['fr']; link: string; copied: boolean; copy: () => void }) {
  return (
    <div className="oj-share">
      <span className="oj-dim">{t.share}</span>
      <code>{link}</code>
      <button className="tab-toggle" onClick={copy}>{copied ? t.copied : t.copy}</button>
    </div>
  );
}
