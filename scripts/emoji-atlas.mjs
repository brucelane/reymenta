// The emoji sheet Cinder draws the audience's emojis from: assets/images/emoji-atlas.png, 8 cells of 128x128 in one
// row, in the order of EMOJIS (src/room/protocol.ts). Images from Google's Noto Emoji (2D/png/128), Apache License 2.0
// (https://github.com/googlefonts/noto-emoji); notice written next to the sheet.
//   pnpm emoji-atlas
import { PNG } from 'pngjs';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', '..', 'assets', 'images');
// EMOJIS order: 🔥 😍 🤯 👏 🚀 🌀 💜 🎛️
const CODES = ['1f525', '1f60d', '1f92f', '1f44f', '1f680', '1f300', '1f49c', '1f39b'];
const CELL = 128;
const BASE = 'https://raw.githubusercontent.com/googlefonts/noto-emoji/main/2D/png/128';

const atlas = new PNG({ width: CELL * CODES.length, height: CELL });
atlas.data.fill(0); // transparent
for (const [i, code] of CODES.entries()) {
  const res = await fetch(`${BASE}/emoji_u${code}.png`);
  if (!res.ok) throw new Error(`emoji_u${code}.png: ${res.status}`);
  const img = PNG.sync.read(Buffer.from(await res.arrayBuffer()));
  // centered in its cell (Noto's 128 px images are 136x128 for some: crop/center)
  const ox = Math.floor((CELL - img.width) / 2);
  const oy = Math.floor((CELL - img.height) / 2);
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const tx = i * CELL + ox + x;
    const ty = oy + y;
    if (tx < i * CELL || tx >= (i + 1) * CELL || ty < 0 || ty >= CELL) continue;
    const s = (y * img.width + x) * 4;
    const d = (ty * atlas.width + tx) * 4;
    img.data.copy(atlas.data, d, s, s + 4);
  }
  console.log(`cell ${i}: emoji_u${code}.png ${img.width}x${img.height}`);
}
writeFileSync(join(outDir, 'emoji-atlas.png'), PNG.sync.write(atlas));
writeFileSync(join(outDir, 'emoji-atlas.LICENSE.txt'), `emoji-atlas.png: 8 emoji images from Noto Emoji by Google
(https://github.com/googlefonts/noto-emoji, png/128: ${CODES.map((c) => `emoji_u${c}.png`).join(', ')}),
licensed under the Apache License, Version 2.0: https://www.apache.org/licenses/LICENSE-2.0
Assembled into one sheet by repos/reymenta/scripts/emoji-atlas.mjs (no other change).
`);
console.log(`written ${join(outDir, 'emoji-atlas.png')}`);
