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

export function connect(
  hello: () => PhoneMessage,
  onMessage: (msg: ServerMessage) => void,
  onStatus: (s: Status) => void,
): Connection {
  let ws: WebSocket | undefined;
  let closed = false;
  let delay = 1000;
  let heartbeat: number | undefined;
  let lastSent = 0;
  const url = serverUrl();

  const open = () => {
    if (closed) return;
    onStatus('connecting');
    ws = new WebSocket(url);
    ws.onopen = () => {
      delay = 1000;
      onStatus('open');
      ws!.send(JSON.stringify(hello()));
      lastSent = Date.now();
      heartbeat = window.setInterval(() => {
        if (Date.now() - lastSent > 4500) send({ t: 'hb' });
      }, 1000);
    };
    ws.onmessage = (e) => {
      try { onMessage(JSON.parse(e.data as string) as ServerMessage); } catch { /* ignore */ }
    };
    ws.onclose = () => {
      window.clearInterval(heartbeat);
      onStatus('closed');
      if (!closed) { setTimeout(open, delay); delay = Math.min(delay * 2, 10000); }
    };
  };

  const send = (msg: PhoneMessage) => {
    if (ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(msg)); lastSent = Date.now(); }
  };

  open();
  return { send, close() { closed = true; ws?.close(); } };
}
