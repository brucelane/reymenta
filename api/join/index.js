// GET /api/join?id=<phone id>&k=<show code>[&room=<room>]  ->  {"url": "wss://.../client/hubs/reymenta?access_token=..."}
// The phone's Web PubSub address: user id = its phone id, allowed to send to the room's "in" group and to listen
// to its "out" group, nothing else.
//
// The gate (2026-11-17, studies/show-access.md): a token only while the show is open and only with the show's
// code (inside the projected QR code, or typed from the screen). Application settings of the Static Web App
// (portal: the SWA > Settings > Environment variables), never in the repo:
//   PUBSUB_CONNECTION_STRING   the Web PubSub resource
//   SHOW_CODE                  the code of this show (letters and digits; compared without case). Required: without
//                              it nobody gets a token
//   SHOW_ROOM                  the only room accepted (default "reymenta")
//   SHOW_OPEN_FROM, SHOW_OPEN_UNTIL   the window, ISO dates with the offset ("2027-01-23T20:30:00+01:00");
//                              tokens expire at SHOW_OPEN_UNTIL
//   SHOW_FORCE                 "open" (rehearsals: no window needed) or "closed" (close at once); empty = the window
//   JOIN_ORIGINS               extra allowed origins for CORS, comma-separated (the page's own and the app's are in)
//   TURNSTILE_SECRET           Cloudflare Turnstile's secret: when set, the page's Turnstile token (&t=) is checked
//                              with Cloudflare (siteverify) before a token is handed out
//   TURNSTILE_SOFT             "1": let phones in when Cloudflare itself can't be reached (never when it says no)
// Answers: 200 {url, room, until}; 403 {closed: true, opensAt?} outside the window; 403 {code: true} without the
// right code; 403 {captcha: true} when Turnstile says no; 400 bad id or room; 503 not configured.
// Same token code as src/cloud/wps.ts (no npm package needed).
const crypto = require('node:crypto');

const ID_RE = /^[A-Za-z0-9_-]{8,40}$/;
const ROOM_RE = /^[a-z0-9-]{2,24}$/;
const HUB = 'reymenta';
const MAX_SECONDS = 3 * 3600;
const ORIGINS = ['https://live.videodromm.com', 'https://zealous-island-06f2fc203.8.azurestaticapps.net',
  'http://localhost', 'https://localhost', 'capacitor://localhost'];

const b64url = (s) => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
function signJwt(payload, key) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', key).update(`${head}.${body}`).digest());
  return `${head}.${body}.${sig}`;
}

/** Codes compared without case or spaces, in constant time (hashes of equal length). */
const normCode = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function codeOk(given, expected) {
  const a = crypto.createHash('sha256').update(normCode(given)).digest();
  const b = crypto.createHash('sha256').update(normCode(expected)).digest();
  return crypto.timingSafeEqual(a, b) && normCode(expected).length > 0;
}

const time = (s) => { const t = Date.parse(s || ''); return Number.isFinite(t) ? t : undefined; };

/** Cloudflare Turnstile: 'ok' | 'no' | 'unreachable'. */
async function turnstile(secret, response, ip) {
  if (!response) return 'no';
  const body = new URLSearchParams({ secret, response, ...(ip ? { remoteip: ip } : {}) });
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body, signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return 'unreachable';
    const data = await res.json();
    return data && data.success === true ? 'ok' : 'no';
  } catch {
    return 'unreachable';
  }
}

/** {open, until?, opensAt?} from SHOW_FORCE and the window. */
function showState(env, now) {
  const force = String(env.SHOW_FORCE || '').toLowerCase();
  const from = time(env.SHOW_OPEN_FROM);
  const until = time(env.SHOW_OPEN_UNTIL);
  if (force === 'closed') return { open: false };
  if (force === 'open') return { open: true, until: until && until > now ? until : undefined };
  if (from === undefined || until === undefined) return { open: false };
  if (now < from) return { open: false, opensAt: new Date(from).toISOString() };
  if (now >= until) return { open: false };
  return { open: true, until };
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
  const showRoom = String(env.SHOW_ROOM || 'reymenta');
  const room = String(req.query.room || showRoom);
  if (!ID_RE.test(id) || !ROOM_RE.test(room)) return reply(400, { error: 'bad id or room' });

  const cs = env.PUBSUB_CONNECTION_STRING || '';
  const endpoint = (/(?:^|;)\s*Endpoint=([^;]+)/i.exec(cs) || [])[1];
  const key = (/(?:^|;)\s*AccessKey=([^;]+)/i.exec(cs) || [])[1];
  if (!endpoint || !key || !normCode(env.SHOW_CODE)) return reply(503, { error: 'not configured' });

  const now = Date.now();
  const show = showState(env, now);
  if (!show.open) return reply(403, { closed: true, ...(show.opensAt ? { opensAt: show.opensAt } : {}) });
  if (room !== showRoom || !codeOk(req.query.k, env.SHOW_CODE)) return reply(403, { code: true });
  if (env.TURNSTILE_SECRET) {
    const fwd = String((req.headers && (req.headers['x-forwarded-for'] || req.headers['X-Forwarded-For'])) || '');
    const check = await turnstile(env.TURNSTILE_SECRET, String(req.query.t || ''), fwd.split(',')[0].trim().replace(/:\d+$/, ''));
    if (check === 'no' || (check === 'unreachable' && env.TURNSTILE_SOFT !== '1')) return reply(403, { captcha: true });
  }

  const nowS = Math.floor(now / 1000);
  const exp = show.until ? Math.min(nowS + MAX_SECONDS, Math.floor(show.until / 1000)) : nowS + MAX_SECONDS;
  const aud = `${endpoint.replace(/\/$/, '')}/client/hubs/${HUB}`;
  const token = signJwt({
    aud, iat: nowS, exp, sub: id,
    role: [`webpubsub.sendToGroup.in-${room}`, `webpubsub.joinLeaveGroup.out-${room}`],
  }, key.trim());
  reply(200, { url: `${aud.replace(/^http/, 'ws')}?access_token=${token}`, room, until: new Date(exp * 1000).toISOString() });
};

module.exports.showState = showState;
module.exports.codeOk = codeOk;
module.exports.turnstile = turnstile;
