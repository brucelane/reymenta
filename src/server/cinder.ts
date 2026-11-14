// The link to Cinder: a websocket client of TSWebsocketServer, as the WebApp is (app=mid). Uniforms go out as
// {"params":[{"name":<index>,"value":<float>}]}, which TSWebsocketServer relays to Cinder (and the WebApp).
// Everything TSWebsocketServer broadcasts back is ignored. Reconnects every 3 s.

import WebSocket from 'ws';

export interface CinderLink {
  /** Sends uniform values (index -> value); dropped while disconnected. */
  sendUniforms(values: Array<{ name: number; value: number }>): void;
  readonly connected: boolean;
  close(): void;
}

export function connectCinder(url: string, token: string, log: (s: string) => void): CinderLink {
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
    ws.on('message', () => { /* not for us */ });
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
