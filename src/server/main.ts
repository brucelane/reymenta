// The audience server, on the show PC (milestone 1: the LAN; Azure Web PubSub replaces the phone side later).
// - phones connect to ws://<host>:<PORT>/ws (through the Vite dev server's https proxy, for the sensors);
// - the room's values go to Cinder as iAud0..31 through TSWebsocketServer;
// - GET /status: the room as JSON (count, aggregates, connection).
// Phones never reach TSWebsocketServer: nothing they send can become a Cinder command.
//
// Environment: PORT (5191), HOST (0.0.0.0), TSWS_URL (ws://127.0.0.1:40088), ACCESS_TOKEN (TSWebsocketServer's;
// read from ../TSWebsocketServer/.env when not set), MODE (circles).
// Cloud (phones on 4G through Azure Web PubSub, hub "reymenta"): PUBSUB_CONNECTION_STRING and ROOM (default
// "demo") in reymenta/.env (git-ignored) or the environment. Phones on the LAN and in the cloud share one room.

import { readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { Bonjour } from 'bonjour-service';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { parsePhoneMessage } from '../room/protocol';
import { IAUD0, Room, type Outgoing } from '../room/room';
import { connectCinder } from './cinder';
import { connectCloud } from './cloud';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 5191);
const HOST = process.env.HOST ?? '0.0.0.0';
const TSWS_URL = process.env.TSWS_URL ?? 'ws://127.0.0.1:40088';

function tswsToken(): string {
  if (process.env.ACCESS_TOKEN !== undefined) return process.env.ACCESS_TOKEN;
  try {
    const env = readFileSync(join(here, '..', '..', '..', 'TSWebsocketServer', '.env'), 'utf8');
    return /^\s*ACCESS_TOKEN\s*=\s*"?([^"\r\n]*)"?/m.exec(env)?.[1]?.trim() ?? '';
  } catch {
    return '';
  }
}

const log = (s: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${s}`);
const room = new Room();
if (process.env.MODE) room.mode = process.env.MODE;
const cinder = connectCinder(TSWS_URL, tswsToken(), log);
const sockets = new Map<string, WebSocket>(); // phone id -> its socket (LAN phones)

// reymenta/.env: KEY=value lines (process.env wins)
const dotenv: Record<string, string> = {};
try {
  for (const line of readFileSync(join(here, '..', '..', '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
    if (m) dotenv[m[1]] = m[2];
  }
} catch { /* no .env */ }
const setting = (k: string) => process.env[k] ?? dotenv[k] ?? '';

// cloud phones: their user id is their phone id (set by /api/join in the token), so a phone can't speak for another
const cloudPhones = new Set<string>();
const cloudRate = new Map<string, { start: number; n: number }>();
const ROOM_NAME = setting('ROOM') || 'demo';
const cloud = setting('PUBSUB_CONNECTION_STRING')
  ? connectCloud(setting('PUBSUB_CONNECTION_STRING'), ROOM_NAME, (userId, raw) => {
      const now = Date.now();
      const r = cloudRate.get(userId) ?? { start: now, n: 0 };
      if (now - r.start > 1000) { r.start = now; r.n = 0; }
      cloudRate.set(userId, r);
      if (++r.n > 20) return;
      const msg = parsePhoneMessage(raw);
      if (!msg || (msg.t === 'hello' && msg.id !== userId)) return;
      if (msg.t === 'hello') cloudPhones.add(userId);
      deliver(room.receive(userId, msg, now));
    }, log)
  : undefined;

function deliver(out: Outgoing[]) {
  for (const { id, msg } of out) {
    const ws = sockets.get(id);
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    else if (cloud && cloudPhones.has(id)) cloud.send(id, msg);
  }
}

const http = createServer((req, res) => {
  // what the Android app's discovery probes (web/src/discovery.ts): says only that this is the audience server
  if (req.url === '/ping') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ app: 'reymenta-audience' }));
    return;
  }
  if (req.url === '/status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      count: room.count, mode: room.mode, cinder: cinder.connected, cloud: cloud ? cloud.link.connected : 'off',
      room: ROOM_NAME, cloudPhones: cloudPhones.size,
      aggregates: room.aggregates(Date.now()).slice(0, 9).map((v) => Math.round(v * 1000) / 1000),
    }));
    return;
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 1024 });
wss.on('connection', (ws) => {
  let id: string | undefined;
  let windowStart = Date.now();
  let inWindow = 0;
  ws.on('message', (data) => {
    // at most 20 messages per second per phone; the rest are dropped
    const now = Date.now();
    if (now - windowStart > 1000) { windowStart = now; inWindow = 0; }
    if (++inWindow > 20) return;
    const msg = parsePhoneMessage(data.toString());
    if (!msg) return;
    if (msg.t === 'hello') {
      if (id && id !== msg.id) return; // one identity per socket
      const old = sockets.get(msg.id);
      if (old && old !== ws) old.close(); // the same phone reconnected
      id = msg.id;
      sockets.set(id, ws);
    }
    if (!id) return;
    deliver(room.receive(id, msg, now));
  });
  ws.on('close', () => {
    if (id && sockets.get(id) === ws) {
      sockets.delete(id);
      deliver(room.leave(id));
    }
  });
  ws.on('error', () => { /* 'close' follows */ });
});

// 20 times a second: drop silent phones, send the values that changed to Cinder
let sent: number[] = [];
let lastCount = -1;
setInterval(() => {
  const now = Date.now();
  deliver(room.prune(now));
  const values = room.aggregates(now);
  const changed: Array<{ name: number; value: number }> = [];
  values.forEach((v, i) => {
    if (sent[i] === undefined || Math.abs(sent[i] - v) > 0.002 || (v === 0 && sent[i] !== 0)) {
      changed.push({ name: IAUD0 + i, value: Math.round(v * 10000) / 10000 });
    }
  });
  if (changed.length && cinder.connected) {
    cinder.sendUniforms(changed);
    sent = values;
  }
  if (room.count !== lastCount) {
    lastCount = room.count;
    log(`${room.count} phone${room.count === 1 ? '' : 's'} in the room`);
  }
}, 50);

http.listen(PORT, HOST, () => {
  log(`audience server on http://${HOST}:${PORT} (phones: /ws, status: /status), mode ${room.mode}`);
  // mDNS: the Android app finds this server without its address being typed (MDNS=0 turns it off).
  // Windows: Node must be allowed through the firewall on private networks (UDP 5353).
  if (process.env.MDNS !== '0') {
    try {
      const service = new Bonjour().publish({ name: `reymenta-${hostname()}`, type: 'reymenta', port: PORT, txt: { app: 'reymenta-audience' } });
      service.on('error', (err: unknown) => log(`mDNS error: ${err}`));
      log(`mDNS: announced _reymenta._tcp on port ${PORT}`);
    } catch (err) {
      log(`mDNS not started: ${err}`);
    }
  }
});
