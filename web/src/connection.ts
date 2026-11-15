// The phone's link to the audience server. In the browser: same-origin <page host>/ws (the Vite dev server
// proxies it on the LAN; Azure Web PubSub later). In the Android app the page runs from http://localhost, so
// the server's address is typed once on the join screen (kept on the phone), e.g. 192.168.1.54:5191.
// Reconnects with a growing delay, says hello again each time.

import type { PhoneMessage, ServerMessage } from '../../src/room/protocol';

export type Status = 'connecting' | 'open' | 'closed';

export interface Connection {
  send(msg: PhoneMessage): void;
  close(): void;
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

  const address = async (): Promise<string> => {
    if (!cloud) return serverUrl();
    const res = await fetch(`${joinBase()}/api/join?id=${encodeURIComponent(phone)}&room=${roomName}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`join ${res.status}`);
    return (await res.json()).url as string;
  };

  const retry = () => {
    if (closed) return;
    setTimeout(open, delay);
    delay = Math.min(delay * 2, 10000);
  };

  const open = async () => {
    if (closed) return;
    onStatus('connecting');
    let url: string;
    try { url = await address(); } catch { onStatus('closed'); retry(); return; }
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

  void open();
  return { send, close() { closed = true; ws?.close(); } };
}
