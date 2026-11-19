// The link to Cinder: a websocket client of TSWebsocketServer, as the WebApp is (app=mid). Uniforms go out as
// {"params":[{"name":<index>,"value":<float>}]}, which TSWebsocketServer relays to Cinder (and the WebApp).
// From what TSWebsocketServer broadcasts back, only Cinder's folder is read (the track it plays, for the emoji
// row, 2026-11-17). Reconnects every 3 s.

import WebSocket from 'ws';

export interface CinderLink {
  /** Sends uniform values (index -> value); dropped while disconnected. */
  sendUniforms(values: Array<{ name: number; value: number }>): void;
  readonly connected: boolean;
  close(): void;
}

/** The folder Cinder has loaded, from its folder announcements and its transport state (every 3 s). */
function cinderFolder(raw: string): string | undefined {
  let m: { event?: string; from?: string; message?: unknown; folder?: unknown };
  try { m = JSON.parse(raw); } catch { return undefined; }
  if (m.from !== 'cinder') return undefined;
  const name = m.event === 'folder' ? m.message : m.event === 'transport' && m.message === 'state' ? m.folder : undefined;
  return typeof name === 'string' && /^[A-Za-z0-9 _.-]{1,64}$/.test(name) && !name.includes('..') ? name : undefined;
}

export function connectCinder(
  url: string, token: string, log: (s: string) => void, onFolder?: (folder: string) => void,
  /** every message TSWebsocketServer relays, raw (the tab clock reads the transport states: tabFollow.ts) */
  onRaw?: (raw: string) => void,
): CinderLink {
  let ws: WebSocket | undefined;
  let connected = false;
  let closed = false;
  let timer: NodeJS.Timeout | undefined;
  const full = `${url.replace(/\/$/, '')}/?app=mid${token ? `&token=${encodeURIComponent(token)}` : ''}`;
  const shown = full.replace(/token=[^&]*/, 'token=***');

  const open = () => {
    if (closed) return;
    ws = new WebSocket(full);
    ws.on('open', () => { connected = true; log(`TSWebsocketServer connected (${shown})`); });
    // only Cinder's folder is read (to know which track plays); everything else is ignored
    ws.on('message', (data) => {
      const raw = data.toString();
      onRaw?.(raw);
      if (!onFolder) return;
      const folder = cinderFolder(raw);
      if (folder) onFolder(folder);
    });
    ws.on('close', () => {
      if (connected) log('TSWebsocketServer disconnected');
      connected = false;
      if (!closed) timer = setTimeout(open, 3000);
    });
    ws.on('error', () => { /* 'close' follows */ });
  };
  open();

  return {
    sendUniforms(values) {
      if (!connected || !ws || values.length === 0) return;
      ws.send(JSON.stringify({ params: values }));
    },
    get connected() { return connected; },
    close() { closed = true; if (timer) clearTimeout(timer); ws?.close(); },
  };
}
