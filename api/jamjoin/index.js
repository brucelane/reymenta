// GET /api/jamjoin?id=<player id>&room=<room code>[&t=<Turnstile token>]  ->  {url, room, group, now, until}
// The online Jam (2026-11-26): players at home jam together through Azure Web PubSub's Free tier (20 connections,
// 20,000 outbound messages of 2 KB a day). No server in the middle: each browser joins the room's group, sends its
// notes there and plays everyone's notes itself (web/src/jam/online). This function only hands out the address:
// - hub "jamonline" (apart from the show's "reymenta" hub), group "jam-<room>", send + join that group only;
// - the token lasts SESSION_SECONDS (1 hour): the page also ends the session then;
// - refused on the show's day: from 00:00 UTC of SHOW_OPEN_FROM's day (when the Free tier's daily message count
//   starts again) to SHOW_OPEN_UNTIL (the same settings as /api/join), and no token lasts into that window: nobody
//   can use up the show's connections or messages that day. The audience server also closes this hub's connections
//   when the show opens (POST /admin/open);
// - JAM_ONLINE=off (SWA application setting) closes it at once;
// - against bots and floods: Cloudflare Turnstile when TURNSTILE_SECRET is set (the page sends &t=, as for /api/join;
//   TURNSTILE_SOFT=1 lets players in when Cloudflare can't be reached), and at most IP_TOKENS tokens per address every
//   IP_WINDOW_MS (kept in the function's memory: best effort, an instance restart forgets it).
// The Free tiers can't cost money (they stop at their limits); what this protects is the show's shared quota.
// `now` is the server's clock: the players line their beat grid up on it (one shared grid, no master).
// The cap of 5 players a room is kept by the pages (they see each other's presence); Web PubSub has no group count.
const crypto = require('node:crypto');
const { turnstile } = require('../join/index.js');

const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const ROOM_RE = /^[a-z0-9]{3,12}$/;
const HUB = 'jamonline';
const SESSION_SECONDS = 3600;
const IP_TOKENS = 6;
const IP_WINDOW_MS = 10 * 60 * 1000;
const ORIGINS = ['https://live.videodromm.com', 'https://zealous-island-06f2fc203.8.azurestaticapps.net',
  'http://localhost', 'https://localhost', 'capacitor://localhost'];

/** address -> times of its last tokens */
const issued = new Map();

const b64url = (s) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function signJwt(payload, key) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', key).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

/** The closed window: 00:00 UTC of the show's first day to its end ({from, until} in ms), or undefined. */
function closedWindow(env) {
  const from = Date.parse(env.SHOW_OPEN_FROM || '');
  const until = Date.parse(env.SHOW_OPEN_UNTIL || '');
  if (!Number.isFinite(from) || !Number.isFinite(until)) return undefined;
  const day = new Date(from);
  return { from: Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()), until };
}

/** Open now? */
function onlineOpen(env, now) {
  if (String(env.JAM_ONLINE || '').toLowerCase() === 'off') return false;
  const w = closedWindow(env);
  return !(w && now >= w.from && now < w.until);
}

/** Until when a token may last: an hour, or the closed window's start when it comes first (ms). */
function tokenEnd(env, now) {
  const w = closedWindow(env);
  const end = now + SESSION_SECONDS * 1000;
  return w && w.from > now ? Math.min(end, w.from) : end;
}

/** At most IP_TOKENS per address per window; true when this one is allowed (and counted). */
function ipAllowed(ip, now) {
  if (!ip) return true;
  const recent = (issued.get(ip) || []).filter((t) => now - t < IP_WINDOW_MS);
  if (recent.length >= IP_TOKENS) { issued.set(ip, recent); return false; }
  recent.push(now);
  issued.set(ip, recent);
  if (issued.size > 5000) for (const [k, v] of issued) if (!v.some((t) => now - t < IP_WINDOW_MS)) issued.delete(k);
  return true;
}

module.exports = async function (context, req) {
  const env = process.env;
  const origin = String((req.headers && (req.headers.origin || req.headers.Origin)) || '');
  const allowed = ORIGINS.concat(String(env.JOIN_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean));
  const reply = (status, body) => {
    const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', vary: 'Origin' };
    if (allowed.includes(origin)) headers['access-control-allow-origin'] = origin;
    context.res = { status, headers, body };
  };

  const id = String(req.query.id || '');
  const room = String(req.query.room || '').toLowerCase();
  if (!ID_RE.test(id) || !ROOM_RE.test(room)) return reply(400, { error: 'bad id or room' });

  const cs = env.PUBSUB_CONNECTION_STRING || '';
  const endpoint = (/(?:^|;)\s*Endpoint=([^;]+)/i.exec(cs) || [])[1];
  const key = (/(?:^|;)\s*AccessKey=([^;]+)/i.exec(cs) || [])[1];
  if (!endpoint || !key) return reply(503, { error: 'not configured' });

  const now = Date.now();
  if (!onlineOpen(env, now)) return reply(403, { closed: true });
  const fwd = String((req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'])) || '');
  const ip = fwd.split(',')[0].trim().replace(/:\d+$/, '');
  if (env.TURNSTILE_SECRET) {
    const check = await turnstile(env.TURNSTILE_SECRET, String(req.query.t || ''), ip);
    if (check === 'no' || (check === 'unreachable' && env.TURNSTILE_SOFT !== '1')) return reply(403, { captcha: true });
  }
  if (!ipAllowed(ip, now)) return reply(429, { error: 'too many' });

  const nowS = Math.floor(now / 1000);
  const exp = Math.floor(tokenEnd(env, now) / 1000);
  if (exp - nowS < 60) return reply(403, { closed: true });
  const aud = `${endpoint.replace(/\/$/, '')}/client/hubs/${HUB}`;
  const group = `jam-${room}`;
  const token = signJwt({ aud, iat: nowS, exp, sub: id, role: [`webpubsub.sendToGroup.${group}`, `webpubsub.joinLeaveGroup.${group}`] }, key.trim());
  reply(200, { url: `${aud.replace(/^http/, 'ws')}?access_token=${token}`, room, group, now, until: new Date(exp * 1000).toISOString() });
};

module.exports.onlineOpen = onlineOpen;
module.exports.tokenEnd = tokenEnd;
module.exports.ipAllowed = ipAllowed;
module.exports.HUB = HUB;
