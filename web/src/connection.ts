// The phone's link to the audience server. In the browser: same-origin <page host>/ws (the Vite dev server
// proxies it on the LAN; Azure Web PubSub later). In the Android app the page runs from http://localhost, so
// the server's address is typed once on the join screen (kept on the phone), e.g. 192.168.1.54:5191.
// Reconnects with a growing delay, says hello again each time.

import type { PhoneMessage, ServerMessage } from '../../src/room/protocol';

// 'gate-closed': the show isn't open (outside its window); 'gate-code': the show's code is missing or wrong
export type Status = 'connecting' | 'open' | 'closed' | 'gate-closed' | 'gate-code';

export interface Connection {
  send(msg: PhoneMessage): void;
  close(): void;
  /** try again now (after the show's code was typed) */
  retryNow(): void;
}

/** True inside the Capacitor app. */
export const isNativeApp = !!(globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

export function phoneId(): string {
  try {
    let id = localStorage.getItem('reymenta:id');
    if (!id || !/^[A-Za-z0-9_-]{8,40}$/.test(id)) {
      id = crypto.randomUUID();
      localStorage.setItem('reymenta:id', id);
    }
    return id;
  } catch {
    return crypto.randomUUID(); // storage blocked: a new identity per visit
  }
}

/** The audience server typed in the app ("192.168.1.54" or "192.168.1.54:5191"), "" when none. */
export function savedServer(): string {
  try { return localStorage.getItem('reymenta:server') ?? ''; } catch { return ''; }
}

export function saveServer(server: string) {
  try { localStorage.setItem('reymenta:server', server.trim()); } catch { /* storage blocked */ }
}

/** The websocket address: the typed server in the app, else the page's own host. */
export function serverUrl(): string {
  const typed = savedServer().replace(/^(wss?|https?):\/\//, '').replace(/\/.*$/, '');
  if (isNativeApp && typed) return `ws://${typed.includes(':') ? typed : `${typed}:5191`}/ws`;
  return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
}

// ---- cloud (Azure Web PubSub through the SWA's /api/join) ----

const params = new URLSearchParams(location.search);
/** The room: ?room= in the address (the QR code projected at the venue), else "reymenta". */
export const roomName = (params.get('room') ?? 'reymenta').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'reymenta';
const LAN_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)|\.local$/;

// The show's code (the gate on /api/join, studies/show-access.md): ?k= in the projected QR code, kept on the
// phone for reloads, and taken out of the address bar so a screenshot or a shared link doesn't carry it.
const CODE_KEY = 'reymenta:k';
export function showCode(): string {
  try { return localStorage.getItem(CODE_KEY) ?? ''; } catch { return ''; }
}
export function saveShowCode(code: string) {
  try { localStorage.setItem(CODE_KEY, code.trim()); } catch { /* storage blocked */ }
}
{
  const k = params.get('k');
  if (k) {
    saveShowCode(k);
    params.delete('k');
    const rest = params.toString();
    history.replaceState(null, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
  }
}
/** When the gate said the show opens (ISO date), for the page's message. */
export let gateOpensAt = '';

/** Where /api/join lives: the page's own site, in the app the public site (?join= or reymenta:join overrides it). */
function joinBase(): string {
  let saved = '';
  try { saved = localStorage.getItem('reymenta:join') ?? ''; } catch { /* storage blocked */ }
  const forced = params.get('join') ?? saved;
  if (forced) return forced.replace(/\/$/, '');
  return isNativeApp ? 'https://live.videodromm.com' : '';
}

/** The cloud is used by a page served from the internet, by ?cloud, or in the app when no local server is set. */
export function useCloud(): boolean {
  if (params.has('cloud')) return true;
  if (params.has('lan')) return false;
  if (isNativeApp) return !savedServer();
  return !LAN_HOST.test(location.hostname);
}

// ---- one connection, either way ----

export function connect(
  hello: () => PhoneMessage,
  onMessage: (msg: ServerMessage) => void,
  onStatus: (s: Status) => void,
  phone = phoneId(),
): Connection {
  let ws: WebSocket | undefined;
  let closed = false;
  let delay = 1000;
  let heartbeat: number | undefined;
  let lastSent = 0;
  let welcomed = false;
  const cloud = useCloud();
  const groupIn = `in-${roomName}`;
  const groupOut = `out-${roomName}`;

  // the cloud wraps each message: {type:"sendToGroup", group, dataType:"json", data}
  const raw = (msg: PhoneMessage) => cloud
    ? JSON.stringify({ type: 'sendToGroup', group: groupIn, dataType: 'json', data: msg, noEcho: true })
    : JSON.stringify(msg);

  class GateError extends Error { constructor(public status: 'gate-closed' | 'gate-code') { super(status); } }

  const address = async (): Promise<string> => {
    if (!cloud) return serverUrl();
    const res = await fetch(`${joinBase()}/api/join?id=${encodeURIComponent(phone)}&room=${roomName}&k=${encodeURIComponent(showCode())}`, { cache: 'no-store' });
    if (res.status === 403) {
      const body = await res.json().catch(() => ({}));
      gateOpensAt = typeof body.opensAt === 'string' ? body.opensAt : '';
      throw new GateError(body.code ? 'gate-code' : 'gate-closed');
    }
    if (res.status === 503) throw new GateError('gate-closed'); // the show isn't set up online
    if (!res.ok) throw new Error(`join ${res.status}`);
    return (await res.json()).url as string;
  };

  const retry = (wait = delay) => {
    if (closed) return;
    setTimeout(open, wait);
    delay = Math.min(delay * 2, 10000);
  };

  const open = async () => {
    if (closed) return;
    onStatus('connecting');
    let url: string;
    try { url = await address(); } catch (e) {
      if (e instanceof GateError) {
        onStatus(e.status);
        // closed: ask again every 30 s (the window opens by itself); a code problem waits for the person
        if (e.status === 'gate-closed') retry(30000);
        return;
      }
      onStatus('closed'); retry(); return;
    }
    ws = cloud ? new WebSocket(url, 'json.webpubsub.azure.v1') : new WebSocket(url);
    ws.onopen = () => {
      delay = 1000;
      onStatus('open');
      if (cloud) ws!.send(JSON.stringify({ type: 'joinGroup', group: groupOut }));
      ws!.send(raw(hello()));
      welcomed = false;
      lastSent = Date.now();
      let lastHello = Date.now();
      heartbeat = window.setInterval(() => {
        // until the server welcomes us, say hello again every 3 s: the show may start after the phone joined
        if (!welcomed && Date.now() - lastHello > 3000) { send(hello()); lastHello = Date.now(); }
        else if (Date.now() - lastSent > 4500) send({ t: 'hb' });
      }, 1000);
    };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(e.data as string);
        // from the server (REST sendToUser) or the room's group; system and ack messages ignored
        const msg = (!cloud ? m : m.type === 'message' && m.data ? (typeof m.data === 'string' ? JSON.parse(m.data) : m.data) : undefined) as ServerMessage | undefined;
        if (!msg) return;
        if (msg.t === 'welcome') welcomed = true;
        if (msg.t === 'rejoin') { welcomed = false; send(hello()); return; } // the server forgot us
        onMessage(msg);
      } catch { /* ignore */ }
    };
    ws.onclose = () => {
      window.clearInterval(heartbeat);
      onStatus('closed');
      retry(); // a new token each time (they expire after 3 hours)
    };
  };

  const send = (msg: PhoneMessage) => {
    if (ws?.readyState === WebSocket.OPEN) { ws.send(raw(msg)); lastSent = Date.now(); }
  };

  // back from the background (screen locked, app switched): the server may have dropped us meanwhile, and
  // the socket may be dead without a close event. Say hello again; if the socket is gone, reopen it.
  const onVisible = () => {
    if (document.visibilityState !== 'visible' || closed) return;
    if (ws?.readyState === WebSocket.OPEN) { welcomed = false; send(hello()); }
    else if (!ws || ws.readyState === WebSocket.CLOSED) { delay = 1000; void open(); }
  };
  document.addEventListener('visibilitychange', onVisible);

  void open();
  return { send, retryNow() { if (!ws || ws.readyState > 1) { delay = 1000; open(); } }, close() { closed = true; document.removeEventListener('visibilitychange', onVisible); ws?.close(); } };
}
