// GET /api/join?id=<phone id>&room=<room>  ->  {"url": "wss://.../client/hubs/reymenta?access_token=..."}
// The phone's Web PubSub address: user id = its phone id, allowed to send to the room's "in" group and to listen
// to its "out" group, nothing else; valid 3 hours. The connection string is the SWA app setting
// PUBSUB_CONNECTION_STRING (never in the repo). Same token code as src/cloud/wps.ts (no npm package needed).
const crypto = require('node:crypto');

const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const ROOM_RE = /^[a-z0-9-]{2,24}$/;
const HUB = 'reymenta';

const b64url = (s) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function signJwt(payload, key) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', key).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

module.exports = async function (context, req) {
  const reply = (status, body) => {
    context.res = { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*' }, body };
  };
  const id = String(req.query.id || '');
  const room = String(req.query.room || 'reymenta');
  if (!ID_RE.test(id) || !ROOM_RE.test(room)) return reply(400, { error: 'bad id or room' });
  const cs = process.env.PUBSUB_CONNECTION_STRING || '';
  const endpoint = (/(?:^|;)\s*Endpoint=([^;]+)/i.exec(cs) || [])[1];
  const key = (/(?:^|;)\s*AccessKey=([^;]+)/i.exec(cs) || [])[1];
  if (!endpoint || !key) return reply(503, { error: 'not configured' });
  const aud = `${endpoint.replace(/\/$/, '')}/client/hubs/${HUB}`;
  const now = Math.floor(Date.now() / 1000);
  const token = signJwt({
    aud, iat: now, exp: now + 3 * 3600, sub: id,
    role: [`webpubsub.sendToGroup.in-${room}`, `webpubsub.joinLeaveGroup.out-${room}`],
  }, key.trim());
  reply(200, { url: `${aud.replace(/^http/, 'ws')}?access_token=${token}`, room });
};
