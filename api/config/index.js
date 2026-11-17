// GET /api/config -> {"turnstile": "<site key>" | ""}: what the phone page needs before joining, from the Static
// Web App's settings, so a change needs no rebuild. TURNSTILE_SITEKEY is public by design (Cloudflare Turnstile's
// site key goes in the page); the secret stays in TURNSTILE_SECRET, read only by /api/join.
module.exports = async function (context) {
  context.res = {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: { turnstile: String(process.env.TURNSTILE_SITEKEY || '') },
  };
};
