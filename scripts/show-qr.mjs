// The QR code projected at a show (studies/show-access.md): https://live.videodromm.com/?k=<code>, with the code
// written under it for the phones that type it. Writes assets/images/reymenta-qr-show.png (git-ignored: the assets
// repo is public), shown by Cinder's folder assets/glsl/reymentaqr. The same code goes in the Static Web App's
// SHOW_CODE setting.
//
//   pnpm show-qr            a new random 6-digit code
//   pnpm show-qr 482913     this code
import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import { randomInt } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', 'assets', 'images', 'reymenta-qr-show.png');
const code = (process.argv[2] ?? String(randomInt(0, 1e6)).padStart(6, '0')).trim();
if (!/^[0-9]{4,12}$/.test(code)) { console.error('the code is 4 to 12 digits'); process.exit(1); }
const url = `https://live.videodromm.com/?k=${code}`;

// 5x7 digits, one string per row, '#' = on
const FONT = {
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
};

const qr = QRCode.create(url, { errorCorrectionLevel: 'M' });
const n = qr.modules.size;
// 16:9 like Cinder's output (a square image was stretched, 2026-11-17): the QR on the left, the code large on the
// right, both kept away from the edges (post.glsl's vignette darkens them)
const W = 1920, H = 1080;
const margin = 4; // quiet zone, in modules
const cell = Math.floor((H * 0.8) / (n + 2 * margin));
const qrPx = cell * (n + 2 * margin);
const ox = Math.floor(W * 0.08);
const oy = Math.floor((H - qrPx) / 2);

const png = new PNG({ width: W, height: H });
const set = (x, y, v) => { const i = (y * W + x) * 4; png.data[i] = png.data[i + 1] = png.data[i + 2] = v; png.data[i + 3] = 255; };
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, 0); // black around: the show's background
for (let y = 0; y < qrPx; y++) for (let x = 0; x < qrPx; x++) set(ox + x, oy + y, 255); // white quiet zone
for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
  if (!qr.modules.get(r, c)) continue;
  for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) set(ox + (c + margin) * cell + x, oy + (r + margin) * cell + y, 0);
}
// the code right of the QR, white on black, as large as the space allows
const left = ox + qrPx + Math.floor(W * 0.05);
const room = W - left - Math.floor(W * 0.08);
const dot = Math.max(4, Math.floor(room / (code.length * 5 + (code.length - 1) * 2)));
const gap = dot * 2;
const textW = code.length * 5 * dot + (code.length - 1) * gap;
let tx = left + Math.floor((room - textW) / 2);
const ty = Math.floor((H - 7 * dot) / 2);
for (const ch of code) {
  FONT[ch].forEach((row, ry) => [...row].forEach((p, rx) => {
    if (p !== '#') return;
    for (let y = 0; y < dot; y++) for (let x = 0; x < dot; x++) set(tx + rx * dot + x, ty + ry * dot + y, 255);
  }));
  tx += 5 * dot + gap;
}
writeFileSync(out, PNG.sync.write(png));
console.log(`code ${code}: QR written to ${out}`);
console.log(`now set SHOW_CODE=${code} in the Static Web App (portal: Settings > Environment variables)`);
