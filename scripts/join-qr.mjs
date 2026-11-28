// The local phone page's address as a QR code in the terminal (2026-11-28): Start-Dev.ps1's "qr" pane, for
// rehearsals with phones on the same Wi-Fi (at a show the phones join through live.videodromm.com instead:
// `pnpm show-qr`, projected by Cinder). Redraws when this PC's address changes (another Wi-Fi, a hotspot).
//
//   pnpm join-qr                 http://<this PC's LAN address>:5192/
//   pnpm join-qr --url <url>     any address (the show's, say)
//
// Wi-Fi phones need port 5192 open in Windows' firewall; a phone on USB uses http://localhost:5192 (adb reverse).
import QRCode from 'qrcode';
import os from 'node:os';

const i = process.argv.indexOf('--url');
const fixed = i > 0 ? process.argv[i + 1] : '';
const PORT = 5192;
// virtual adapters (WSL, Hyper-V, VPNs) aren't reachable from a phone
const VIRTUAL = /vEthernet|WSL|Hyper-V|VirtualBox|VMware|Loopback|Tailscale|ZeroTier|Bluetooth/i;

function lanAddress() {
  const found = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) found.push(a.address);
  }
  const rank = (ip) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  return found.sort((a, b) => rank(a) - rank(b))[0] ?? '';
}

let shown = '';
async function draw() {
  const ip = fixed ? '' : lanAddress();
  const url = fixed || (ip ? `http://${ip}:${PORT}/` : '');
  if (url === shown) return;
  shown = url;
  console.clear();
  if (!url) { console.log('No network address (Wi-Fi off?). Phone on USB: http://localhost:5192'); return; }
  // the address first (a short pane cuts the bottom), the code, then the hints only if the pane has room
  const qr = (await QRCode.toString(url, { type: 'terminal', small: true, errorCorrectionLevel: 'L' })).replace(/\n+$/, '');
  console.log(`${url}\n${qr}`);
  const rows = process.stdout.rows || 0;
  if (!fixed && rows >= qr.split('\n').length + 3) console.log('USB phone: http://localhost:5192');
}
await draw();
setInterval(() => { draw().catch(() => {}); }, 10000);
// redrawn when the pane is resized (the hint line comes and goes)
process.stdout.on('resize', () => { shown = ''; draw().catch(() => {}); });
