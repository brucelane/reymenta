// The Android app finds the audience server on the Wi-Fi (adapted from the WebApp's lib/lanDiscovery.ts, same
// capacitor-lan plugin). In order: the address found last time, mDNS (the server announces "_reymenta._tcp"),
// then a scan of the phone's /24 on port 5191 (nearest addresses first). A candidate counts when GET /ping
// answers {"app":"reymenta-audience"}. Returns "host:port", or "" when nothing answers. Native only: a browser
// connects to the page's own host.

import { Capacitor, registerPlugin } from '@capacitor/core';

interface LanDiscoveryPlugin {
  getWifiAddress(): Promise<{ ip?: string; prefix?: number }>;
  discover(options: { type: string; timeout: number }): Promise<{ host?: string; port?: number; name?: string }>;
}
const Lan = registerPlugin<LanDiscoveryPlugin>('LanDiscovery');

const PORT = 5191;
const FOUND_KEY = 'reymenta:found';

export async function probe(hostPort: string, ms = 700): Promise<boolean> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(`http://${hostPort}/ping`, { signal: ctrl.signal, cache: 'no-store' });
    return res.ok && (await res.json())?.app === 'reymenta-audience';
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function viaMdns(): Promise<string> {
  try {
    const s = await Lan.discover({ type: '_reymenta._tcp.', timeout: 4000 });
    if (!s.host) return '';
    const host = s.host.includes(':') ? `[${s.host}]` : s.host;
    const hp = `${host}:${s.port || PORT}`;
    return (await probe(hp)) ? hp : '';
  } catch {
    return '';
  }
}

async function viaScan(): Promise<string> {
  let ip = '';
  try { ip = (await Lan.getWifiAddress()).ip ?? ''; } catch { return ''; }
  const m = /^(\d+\.\d+\.\d+)\.(\d+)$/.exec(ip);
  if (!m) return '';
  const own = Number(m[2]);
  const hosts = Array.from({ length: 254 }, (_, i) => i + 1)
    .filter((n) => n !== own)
    .sort((a, b) => Math.abs(a - own) - Math.abs(b - own));
  const deadline = Date.now() + 6000;
  let found = '';
  let next = 0;
  const worker = async () => {
    while (!found && next < hosts.length && Date.now() < deadline) {
      const hp = `${m[1]}.${hosts[next++]}:${PORT}`;
      if (await probe(hp, 600)) found = found || hp;
    }
  };
  await Promise.all(Array.from({ length: 32 }, worker));
  return found;
}

/** Finds the audience server; onStatus gets a short progress text. Never throws. */
export async function discoverServer(onStatus?: (step: 'last' | 'mdns' | 'scan') => void): Promise<string> {
  if (!Capacitor.isNativePlatform()) return '';
  let last = '';
  try { last = localStorage.getItem(FOUND_KEY) ?? ''; } catch { /* storage blocked */ }
  onStatus?.('last');
  if (last && (await probe(last))) return last;
  onStatus?.('mdns');
  const found = (await viaMdns()) || (onStatus?.('scan'), await viaScan());
  if (found) { try { localStorage.setItem(FOUND_KEY, found); } catch { /* storage blocked */ } }
  return found;
}
