// Checks the cloud path end to end, without the SWA: `pnpm tsx scripts/cloud-check.ts` while `pnpm server` runs
// with PUBSUB_CONNECTION_STRING in reymenta/.env. Acts as a phone: makes its own address (as /api/join would),
// joins the room, says hello through the "in" group, and waits for the server's welcome (REST sendToUser).
import { readFileSync } from 'node:fs';
import WebSocket from 'ws';
import { clientUrl, parseConnectionString, phoneRoles } from '../src/cloud/wps';

const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split(/\r?\n/)
  .map((l) => /^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/.exec(l)).filter(Boolean).map((m) => [m![1], m![2]]));
const ps = parseConnectionString(env.PUBSUB_CONNECTION_STRING ?? '');
if (!ps) { console.error('reymenta/.env: PUBSUB_CONNECTION_STRING missing or unreadable'); process.exit(1); }
const room = env.ROOM || 'reymenta';
const id = `check-${Math.random().toString(36).slice(2, 10)}`;

const ws = new WebSocket(clientUrl(ps, id, phoneRoles(room), 600), 'json.webpubsub.azure.v1');
const timer = setTimeout(() => { console.error('no welcome within 10 s (is pnpm server running with the cloud on?)'); process.exit(1); }, 10000);
ws.on('open', () => {
  console.log(`connected to ${new URL(ps.endpoint).host} as ${id}, room ${room}`);
  ws.send(JSON.stringify({ type: 'joinGroup', group: `out-${room}` }));
  ws.send(JSON.stringify({ type: 'sendToGroup', group: `in-${room}`, dataType: 'json', noEcho: true, data: { t: 'hello', id, lang: 'fr' } }));
});
ws.on('message', (d) => {
  const m = JSON.parse(d.toString());
  if (m.type === 'message' && m.data?.t === 'welcome') {
    console.log(`welcome: slot ${m.data.slot}, name ${m.data.name.fr} / ${m.data.name.en}`);
    clearTimeout(timer);
    ws.close();
    process.exit(0);
  }
});
ws.on('error', (e) => { console.error(`error: ${e.message}`); process.exit(1); });
