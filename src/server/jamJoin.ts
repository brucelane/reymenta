// GET /api/jamjoin on the audience server (2026-11-26): the online Jam's address, for `pnpm dev` and the LAN page.
// It runs the Static Web App's own function (api/jamjoin/index.js), so the page talks to the same code here and on
// live.videodromm.com; the Web PubSub connection string comes from .env (PUBSUB_CONNECTION_STRING).
import { createRequire } from 'node:module';
import type { IncomingMessage, ServerResponse } from 'node:http';

type Fn = (context: { res?: { status: number; headers: Record<string, string>; body: unknown } }, req: { query: Record<string, string>; headers: IncomingMessage['headers'] }) => Promise<void>;
const fn = createRequire(import.meta.url)('../../api/jamjoin/index.js') as Fn;

/** true when it answered */
export function handleJamJoin(req: IncomingMessage, res: ServerResponse, connectionString: string): boolean {
  if (!req.url?.startsWith('/api/jamjoin')) return false;
  if (req.method !== 'GET') { res.writeHead(405).end(); return true; }
  if (connectionString && !process.env.PUBSUB_CONNECTION_STRING) process.env.PUBSUB_CONNECTION_STRING = connectionString;
  const query = Object.fromEntries(new URL(req.url, 'http://local').searchParams);
  const context: Parameters<Fn>[0] = {};
  fn(context, { query, headers: req.headers }).then(() => {
    const r = context.res ?? { status: 500, headers: {}, body: { error: 'no answer' } };
    res.writeHead(r.status, { ...r.headers, 'content-type': 'application/json' });
    res.end(JSON.stringify(r.body));
  }, () => { res.writeHead(500).end(); });
  return true;
}
