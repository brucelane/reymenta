// The phone's link to the audience server: same-origin wss://<page host>/ws (the Vite dev server proxies it
// on the LAN; Azure Web PubSub later). Reconnects with a growing delay, says hello again each time.

import type { PhoneMessage, ServerMessage } from '../../src/room/protocol';

export type Status = 'connecting' | 'open' | 'closed';

export interface Connection {
  send(msg: PhoneMessage): void;
  close(): void;
}

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
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

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
