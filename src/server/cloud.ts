// The audience server's cloud side (Azure Web PubSub, hub "reymenta"): phones on 4G send to the group
// "in-<room>", this server listens there and answers each phone through the REST API (sendToUser).
// Room-wide messages could go to "out-<room>" (one message for everyone); today every answer is per phone.
// Subprotocol json.webpubsub.azure.v1: {type:"joinGroup"}, then {type:"message", from:"group", fromUserId, data}.

import WebSocket from 'ws';
import { clientUrl, closeConnections, groupIn, groupOut, parseConnectionString, sendToUser, serverRoles, type PubSub } from '../cloud/wps';

export interface CloudLink { close(): void; readonly connected: boolean }

export function connectCloud(
  connectionString: string,
  room: string,
  onPhoneMessage: (userId: string, raw: string) => void,
  log: (s: string) => void,
): { link: CloudLink; send: (userId: string, msg: unknown) => void; broadcast: (msg: unknown) => void; kickUser: (userId: string) => Promise<boolean>; kickRoom: () => Promise<boolean> } | undefined {
  const ps: PubSub | undefined = parseConnectionString(connectionString);
  if (!ps) { log('cloud: PUBSUB_CONNECTION_STRING unreadable, cloud off'); return undefined; }
  let ws: WebSocket | undefined;
  let connected = false;
  let closed = false;
  let ackId = 1;

  const open = () => {
    if (closed) return;
    ws = new WebSocket(clientUrl(ps, `server-${room}`, serverRoles(room)), 'json.webpubsub.azure.v1');
    ws.on('open', () => {
      connected = true;
      ws!.send(JSON.stringify({ type: 'joinGroup', group: groupIn(room), ackId: ackId++ }));
      log(`cloud: connected to ${new URL(ps.endpoint).host}, hub reymenta, room "${room}"`);
    });
    ws.on('message', (data) => {
      let m: { type?: string; from?: string; fromUserId?: string; data?: unknown; success?: boolean; error?: unknown };
      try { m = JSON.parse(data.toString()); } catch { return; }
      if (m.type === 'ack' && m.success === false) log(`cloud: refused: ${JSON.stringify(m.error)}`);
      if (m.type === 'message' && m.from === 'group' && m.fromUserId) {
        // the data is the phone's message, as JSON (object) or text
        const raw = typeof m.data === 'string' ? m.data : JSON.stringify(m.data);
        onPhoneMessage(m.fromUserId, raw);
      }
    });
    ws.on('close', () => {
      if (connected) log('cloud: disconnected');
      connected = false;
      if (!closed) setTimeout(open, 3000);
    });
    ws.on('error', () => { /* 'close' follows */ });
  };
  open();

  return {
    link: { close() { closed = true; ws?.close(); }, get connected() { return connected; } },
    send: (userId, msg) => { void sendToUser(ps, userId, msg); },
    // one message for every phone of the room: their "out" group (this server may send there, serverRoles)
    broadcast: (msg) => {
      if (connected && ws) ws.send(JSON.stringify({ type: 'sendToGroup', group: groupOut(room), dataType: 'json', data: msg, ackId: ackId++ }));
    },
    // phones join "out-<room>" when they connect; this server only joins "in-<room>", so closing "out" spares it
    kickUser: (userId) => closeConnections(ps, { user: userId }),
    kickRoom: () => closeConnections(ps, { group: groupOut(room) }),
  };
}
