// The audience server, on the show PC (milestone 1: the LAN; Azure Web PubSub replaces the phone side later).
// - phones connect to ws://<host>:<PORT>/ws (through the Vite dev server's https proxy, for the sensors);
// - the room's values go to Cinder as iAud0..31 through TSWebsocketServer;
// - GET /status: the room as JSON (count, aggregates, connection);
// - GET /api/library/<path>: the public library for the Workshop (assets/public/library, LIBRARY_DIR).
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
import { validateJam, rootOf } from '../jam/config';
import { Jam } from '../jam/jam';
import { startLink, type LinkPoller } from './link';
import { TabFollow } from './tabFollow';
import { defaultLibraryDir, handleLibrary } from './library';

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
const cinder = connectCinder(TSWS_URL, tswsToken(), log, (folder) => onCinderFolder(folder), (raw) => onRelayed(raw));
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
const ROOM_NAME = setting('ROOM') || 'reymenta';
// open/closed (studies/show-access.md): closed, every phone is disconnected and any that comes back is closed at
// once (cloud: through the REST API, at most once per phone every 10 s). In memory: a restart opens again
// (SHOW_CLOSED=1 in the environment or .env starts closed).
let showOpen = setting('SHOW_CLOSED') !== '1';
const kicked = new Map<string, number>(); // cloud phone -> last kick
const kickCloudPhone = (userId: string) => {
  const now = Date.now();
  if (!cloud || now - (kicked.get(userId) ?? 0) < 10000) return;
  kicked.set(userId, now);
  void cloud.kickUser(userId);
};

const cloud = setting('PUBSUB_CONNECTION_STRING')
  ? connectCloud(setting('PUBSUB_CONNECTION_STRING'), ROOM_NAME, (userId, raw) => {
      if (!showOpen) { kickCloudPhone(userId); return; }
      const now = Date.now();
      const r = cloudRate.get(userId) ?? { start: now, n: 0 };
      if (now - r.start > 1000) { r.start = now; r.n = 0; }
      cloudRate.set(userId, r);
      if (++r.n > 20) return;
      const msg = parsePhoneMessage(raw);
      if (!msg || (msg.t === 'hello' && msg.id !== userId)) return;
      if (msg.t === 'emo' && !emojisOn()) return;
      if (msg.t === 'hello') cloudPhones.add(userId);
      if (msg.t === 'tab') onTabView(userId, msg.on);
      if (msg.t.startsWith('j')) { onJam(userId, msg); if (msg.t !== 'jam') return; }
      deliver(room.receive(userId, msg, now));
    }, log)
  : undefined;

function deliver(out: Outgoing[]) {
  for (const { id, msg } of out) {
    const send = (m: unknown) => {
      const ws = sockets.get(id);
      if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
      else if (cloud && cloudPhones.has(id)) cloud.send(id, m);
    };
    send(msg);
    if (msg.t === 'welcome') send({ t: 'emojis', on: emojisOn() }); // a phone that joins learns the row's state
  }
}

// The emoji row on the phones (2026-11-17): hidden until the track Cinder plays opens it ("audienceEmojis": true
// in assets/glsl/<folder>/track.json), or the operator forces it (POST /admin/emojis/on|off|auto, Show-Access.ps1).
// Emoji taps are ignored while it's hidden.
const assetsGlsl = join(here, '..', '..', '..', 'assets', 'glsl');
let emojiMode: 'auto' | 'on' | 'off' = 'auto';
let trackEmojis = false;
let cinderFolderName = '';
const emojisOn = () => emojiMode === 'on' || (emojiMode === 'auto' && trackEmojis);

function broadcastEmojis(before: boolean) {
  const on = emojisOn();
  if (on === before) return;
  const msg = { t: 'emojis', on };
  for (const ws of sockets.values()) if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  cloud?.broadcast(msg);
  log(`emoji row ${on ? 'SHOWN' : 'hidden'} (${emojiMode === 'auto' ? `track ${cinderFolderName || '?'}` : `forced ${emojiMode}`})`);
}

function onCinderFolder(folder: string) {
  if (folder === cinderFolderName) return;
  cinderFolderName = folder;
  const before = emojisOn();
  try {
    trackEmojis = JSON.parse(readFileSync(join(assetsGlsl, folder, 'track.json'), 'utf8')).audienceEmojis === true;
  } catch {
    trackEmojis = false; // no track.json: no emojis
  }
  broadcastEmojis(before);
}

// The playing bass tab (2026-11-19, studies/reymenta-workshop.md): phones that open the tab view get the track's tab
// once and the clock every second while it plays (only them: cloud messages count against the quota)
const tabFollow = new TabFollow(assetsGlsl);
const tabPhones = new Map<string, string>(); // phone id -> the folder whose tab it has ("" = none yet)

function sendTo(id: string, m: unknown) {
  const ws = sockets.get(id);
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
  else if (cloud && cloudPhones.has(id)) cloud.send(id, m);
}

/** The clock (and the tab, when the phone doesn't have this track's yet) to the tab-view phones. */
function sendTab(only?: string) {
  const clock = tabFollow.clock();
  if (!clock) return;
  for (const [id, has] of tabPhones) {
    if (only && id !== only) continue;
    if (has !== clock.f) {
      tabFollow.forget(clock.f); // re-read: the tab may have been rebuilt since
      const tab = tabFollow.tab(clock.f);
      if (tab) sendTo(id, tab);
      tabPhones.set(id, clock.f);
    }
    sendTo(id, clock);
  }
}

// Ableton Link (2026-11-20, optional: LINK=1 and the native module, link.ts): the tab follows Live's tempo and start/stop
let link: LinkPoller | undefined;
if (process.env.LINK === '1') {
  if (process.env.LINK_FOLDER) tabFollow.linkFolder = process.env.LINK_FOLDER;
  const from = Number(process.env.LINK_FROM_BAR);
  if (from >= 1) tabFollow.linkFromBar = Math.floor(from);
  void startLink((st) => { if (tabFollow.receiveLink(st)) sendTab(); }).then((r) => {
    if (typeof r === 'string') log(r);
    else { link = r; log('Ableton Link on (the tab follows Live while it plays)'); }
  });
}

// The Jam (2026-11-20, src/jam, studies/reymenta-jam.md): phones play the organiser's Live template through
// TSWebsocketServer's MIDI ({"event":"midimsg"} on the MIDI output named in jam.json), notes on Link's beat grid.
// Closed until the organiser opens it (POST /admin/jam/on, or JAM_OPEN=1).
const JAM_FILE = setting('JAM_FILE') || join(assetsGlsl, '..', 'jam', 'jam.json');
let jamError = '';
function loadJam() {
  try {
    const v = validateJam(JSON.parse(readFileSync(JAM_FILE, 'utf8')));
    if (typeof v === 'string') { jamError = v; return undefined; }
    jamError = '';
    return v;
  } catch (e) {
    jamError = (e as Error).message;
    return undefined;
  }
}
const jamConfig = loadJam();
if (!jamConfig) log(`jam: ${JAM_FILE}: ${jamError}`);
const jam = jamConfig
  ? new Jam(
      jamConfig,
      (messages, delay) => {
        const send = () => { cinder.sendRaw({ event: 'midimsg', port: jam!.cfg.port, messages }); };
        if (delay > 0) setTimeout(send, delay); else send();
      },
      () => {
        const st = link?.state();
        return st && st.peers > 0 ? { beat: st.beat, bpm: st.tempo, playing: st.playing } : undefined;
      },
      Date.now,
      setting('JAM_OPEN') === '1',
    )
  : undefined;
const jamPhones = new Set<string>();
let jamDirty = false;
function sendJamState(only?: string) {
  if (!jam) return;
  for (const id of jamPhones) if (!only || id === only) sendTo(id, jam.state(id));
}
function onJam(id: string, msg: ReturnType<typeof parsePhoneMessage>) {
  if (!msg || !jam) {
    if (msg?.t === 'jam' && msg.on) sendTo(id, { t: 'jam', on: false, title: '', root: 0, mode: 'minor', steps: [], bpm: 120, link: false, tracks: [], mine: -1 });
    return;
  }
  switch (msg.t) {
    case 'jam':
      if (msg.on) { jam.join(id); jamPhones.add(id); sendJamState(id); sendTo(id, jam.beat()); } else { jam.leave(id); jamPhones.delete(id); jamDirty = true; }
      break;
    case 'jt':
      if (jam.pick(id, msg.k)) jamDirty = true;
      sendJamState(id);
      break;
    case 'jn': jam.pad(id, msg.p, msg.on === 1, msg.v); break;
    case 'jk': jam.knob(id, msg.k, msg.v); break;
    case 'jc': jam.clip(id, msg.c); break;
    default: break;
  }
}
const jamLeave = (id: string) => { if (jamPhones.delete(id)) { jam?.leave(id); jamDirty = true; } };

function onRelayed(raw: string) {
  if (tabFollow.receive(raw)) sendTab();
}

function onTabView(id: string, on: boolean) {
  if (on) { tabPhones.set(id, ''); sendTab(id); } else tabPhones.delete(id);
}

function setEmojiMode(mode: 'auto' | 'on' | 'off') {
  const before = emojisOn();
  emojiMode = mode;
  broadcastEmojis(before);
}

/** Closes the show: everyone out of the room, LAN sockets closed, cloud phones disconnected. */
async function closeShow(): Promise<string> {
  showOpen = false;
  for (const id of [...sockets.keys()]) { deliver(room.leave(id)); sockets.get(id)?.close(); }
  sockets.clear();
  let cloudResult = 'no cloud';
  if (cloud) {
    const ids = [...cloudPhones];
    for (const id of ids) deliver(room.leave(id));
    const ok = await cloud.kickRoom();
    await Promise.all(ids.map((id) => cloud.kickUser(id)));
    cloudPhones.clear();
    cloudResult = `${ids.length} cloud phone(s) closed${ok ? '' : ' (the room-wide close failed)'}`;
  }
  log(`show CLOSED: ${cloudResult}`);
  return cloudResult;
}

const isLocal = (addr?: string) => !!addr && /^(127\.|::1$|::ffff:127\.)/.test(addr);
const ADMIN_TOKEN = tswsToken();

const LIBRARY_DIR = defaultLibraryDir(here);

const http = createServer((req, res) => {
  // the public library for the Workshop (read only, any origin): src/server/library.ts
  if (handleLibrary(LIBRARY_DIR, req, res)) return;
  // admin (Show-Access.ps1): this PC only, with TSWebsocketServer's token when it has one
  const emojiCmd = /^\/admin\/emojis\/(on|off|auto)$/.exec(req.url ?? '');
  // the Jam (2026-11-20): on | off | reload | clip/<track>/<clip>/on|off | scale/<root>/<mode>
  const jamCmd = /^\/admin\/jam\/(on|off|reload|clip\/(\d+)\/(\d+)\/(on|off)|scale\/([A-Ga-g][#b]?)\/(\w+))$/.exec(req.url ?? '');
  if (jamCmd) {
    if (req.method !== 'POST' || !isLocal(req.socket.remoteAddress) || (ADMIN_TOKEN && req.headers['x-token'] !== ADMIN_TOKEN)) {
      res.writeHead(403).end();
      return;
    }
    const answer = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (!jam && jamCmd[1] !== 'reload') return answer(409, { error: `no jam: ${jamError}` });
    let ok = true;
    if (jamCmd[1] === 'on' || jamCmd[1] === 'off') { jam!.setOpen(jamCmd[1] === 'on'); log(`jam ${jamCmd[1].toUpperCase()}`); }
    else if (jamCmd[1] === 'reload') {
      const cfg = loadJam();
      if (!cfg) return answer(400, { error: jamError });
      if (!jam) return answer(409, { error: 'the server started without a jam file: restart it' });
      jam.reload(cfg);
    } else if (jamCmd[2] !== undefined) ok = jam!.setClip(Number(jamCmd[2]), Number(jamCmd[3]), jamCmd[4] === 'on');
    else ok = jam!.setScale(rootOf(jamCmd[5]) ?? -1, jamCmd[6]);
    if (!ok) return answer(400, { error: 'no such clip, or an unknown scale' });
    jamDirty = true;
    return answer(200, { open: jam!.open, players: jam!.count, state: jam!.state() });
  }
  if (req.url === '/admin/open' || req.url === '/admin/close' || emojiCmd) {
    if (req.method !== 'POST' || !isLocal(req.socket.remoteAddress) || (ADMIN_TOKEN && req.headers['x-token'] !== ADMIN_TOKEN)) {
      res.writeHead(403).end();
      return;
    }
    const done = (body: unknown) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (emojiCmd) { setEmojiMode(emojiCmd[1] as 'auto' | 'on' | 'off'); done({ emojis: emojisOn(), mode: emojiMode, track: cinderFolderName }); }
    else if (req.url === '/admin/open') { showOpen = true; kicked.clear(); log('show OPEN'); done({ open: true }); }
    else void closeShow().then((cloudResult) => done({ open: false, cloud: cloudResult }));
    return;
  }
  // what the Android app's discovery probes (web/src/discovery.ts): says only that this is the audience server
  if (req.url === '/ping') {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(JSON.stringify({ app: 'reymenta-audience' }));
    return;
  }
  if (req.url === '/status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      open: showOpen, emojis: { on: emojisOn(), mode: emojiMode, track: cinderFolderName, trackOpens: trackEmojis }, count: room.count, mode: room.mode, cinder: cinder.connected, cloud: cloud ? cloud.link.connected : 'off',
      room: ROOM_NAME, cloudPhones: cloudPhones.size,
      jam: jam ? { open: jam.open, players: jam.count, title: jam.cfg.title, port: jam.cfg.port } : { error: jamError, file: JAM_FILE },
      tabClock: tabFollow.source ?? 'none', link: link ? { ...link.state(), folder: tabFollow.linkFolder ?? null } : process.env.LINK === '1' ? 'not available' : 'off',
      aggregates: room.aggregates(Date.now()).slice(0, 16).map((v) => Math.round(v * 1000) / 1000),
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
    if (!showOpen) { ws.close(); return; }
    const msg = parsePhoneMessage(data.toString());
    if (!msg) return;
    if (msg.t === 'emo' && !emojisOn()) return;
    if (msg.t === 'hello') {
      if (id && id !== msg.id) return; // one identity per socket
      const old = sockets.get(msg.id);
      if (old && old !== ws) old.close(); // the same phone reconnected
      id = msg.id;
      sockets.set(id, ws);
    }
    if (!id) return;
    if (msg.t === 'tab') onTabView(id, msg.on);
    if (msg.t.startsWith('j')) { onJam(id, msg); if (msg.t !== 'jam') return; }
    deliver(room.receive(id, msg, now));
  });
  ws.on('close', () => {
    if (id && sockets.get(id) === ws) {
      sockets.delete(id);
      tabPhones.delete(id);
      jamLeave(id);
      deliver(room.leave(id));
    }
  });
  ws.on('error', () => { /* 'close' follows */ });
});

// 20 times a second: drop silent phones, send the values that changed to Cinder
let sent: number[] = [];
let lastCount = -1;
let lastTabClock = 0;
let lastJamBeat = 0;
let lastJamState = 0;
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
  // the Jam: knobs and stuck notes 20 times a second, the beat each second, the state when it changed (2 a second)
  if (jam) {
    jam.tick();
    if (jamPhones.size && now - lastJamBeat >= 1000) {
      lastJamBeat = now;
      const inRoom = new Set(room.participants().map((p) => p.id));
      for (const id of [...jamPhones]) if (!inRoom.has(id)) jamLeave(id);
      const b = jam.beat();
      for (const id of jamPhones) sendTo(id, b);
    }
    if (jamDirty && now - lastJamState >= 500) { lastJamState = now; jamDirty = false; sendJamState(); }
  }
  // the tab clock once a second while the song plays (phones extrapolate in between)
  if (tabPhones.size && now - lastTabClock >= 1000) {
    lastTabClock = now;
    // phones that left the room (asleep, cloud phones gone) stop getting the clock
    const inRoom = new Set(room.participants().map((p) => p.id));
    for (const id of tabPhones.keys()) if (!inRoom.has(id)) tabPhones.delete(id);
    if (tabFollow.playing) sendTab();
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
