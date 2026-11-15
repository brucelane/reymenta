// Azure Web PubSub without the SDK: a token is a JWT signed (HS256) with the resource's access key, so the
// audience server and the SWA's /api/join can make them with node:crypto alone. Used for:
// - client URLs (phones, the audience server): wss://<host>/client/hubs/<hub>?access_token=<jwt>
// - the REST API (server -> one phone): POST https://<host>/api/hubs/<hub>/users/<id>/:send?api-version=2024-01-01
// Groups per room: "in-<room>" (phones send, the server listens), "out-<room>" (the server sends, phones listen).

import { createHmac } from 'node:crypto';

export interface PubSub { endpoint: string; key: string }

/** "Endpoint=https://x.webpubsub.azure.com;AccessKey=...;Version=1.0;" -> {endpoint, key} */
export function parseConnectionString(cs: string): PubSub | undefined {
  const get = (k: string) => new RegExp(`(?:^|;)\\s*${k}=([^;]+)`, 'i').exec(cs)?.[1]?.trim();
  const endpoint = get('Endpoint')?.replace(/\/$/, '');
  const key = get('AccessKey');
  return endpoint && key ? { endpoint, key } : undefined;
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

export function signJwt(payload: Record<string, unknown>, key: string): string {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(createHmac('sha256', key).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

export const HUB = 'reymenta';
export const groupIn = (room: string) => `in-${room}`;
export const groupOut = (room: string) => `out-${room}`;
export const ROOM_RE = /^[a-z0-9-]{2,24}$/;

/** A client access URL: userId, roles, lifetime in seconds. */
export function clientUrl(ps: PubSub, userId: string, roles: string[], seconds = 3 * 3600): string {
  const aud = `${ps.endpoint}/client/hubs/${HUB}`;
  const now = Math.floor(Date.now() / 1000);
  const token = signJwt({ aud, iat: now, exp: now + seconds, sub: userId, role: roles }, ps.key);
  return `${aud.replace(/^http/, 'ws')}?access_token=${token}`;
}

/** Roles of a phone in a room: send to the server's group, listen to the room's group. */
export const phoneRoles = (room: string) => [`webpubsub.sendToGroup.${groupIn(room)}`, `webpubsub.joinLeaveGroup.${groupOut(room)}`];
/** Roles of the audience server in a room. */
export const serverRoles = (room: string) => [`webpubsub.joinLeaveGroup.${groupIn(room)}`, `webpubsub.sendToGroup.${groupOut(room)}`];

/** REST: sends a JSON message to one user (a phone). Resolves false on failure. */
export async function sendToUser(ps: PubSub, userId: string, data: unknown): Promise<boolean> {
  const url = `${ps.endpoint}/api/hubs/${HUB}/users/${encodeURIComponent(userId)}/:send?api-version=2024-01-01`;
  const now = Math.floor(Date.now() / 1000);
  const token = signJwt({ aud: url, iat: now, exp: now + 300 }, ps.key);
  try {
    const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(data) });
    return res.ok;
  } catch {
    return false;
  }
}
