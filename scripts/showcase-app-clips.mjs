#!/usr/bin/env node
// Join-screen carousel clips of the app itself (web/src/Showcase.tsx): node scripts/showcase-app-clips.mjs
// Needs the audience server with the jam open and the page running (Start-Dev: ports 5191 + 5192).
// Records, in headless Chrome at 1024x576 (puppeteer-core from ../TSWebsocketServer, CDP screencast), then ffmpeg:
//   web/public/showcase/music.mp4 + .jpg    the Jam: Synth 1's scale pads, a melody tapped on them
//   web/public/showcase/strudel.mp4 + .jpg  the Workshop: the track "ambivalence", its Strudel patch playing
// (scripts/showcase-clips.mjs makes eyes + circles, without any server.)

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, '..', 'TSWebsocketServer', 'package.json'));
const puppeteer = require('puppeteer-core');
const out = join(root, 'web', 'public', 'showcase');
const URL = 'http://localhost:5192/';
const W = 1024, H = 576, FPS = 30;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const chrome = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => existsSync(p));
if (!chrome) { console.error('no Chrome/Edge found'); process.exit(1); }
for (const u of ['http://127.0.0.1:5191/ping', URL]) {
  try { if (!(await fetch(u)).ok) throw 0; } catch { console.error(`${u} doesn't answer: run Start-Dev first`); process.exit(1); }
}

const clickText = (page, sel, text) => page.$$eval(sel, (els, t) => {
  const e = els.find((x) => x.innerText.includes(t)); if (e) e.click(); return !!e;
}, text);

async function newPage(browser) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('page:', e.message));
  await page.setViewport({ width: W, height: H, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument(() => { localStorage.setItem('reymenta:lang', 'fr'); });
  return page;
}

// records `act` through the CDP screencast, then encodes the frames at their real timing into <name>.mp4 (+ a .jpg)
async function record(page, name, act) {
  const cdp = await page.createCDPSession();
  const frames = [];
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    frames.push({ data, t: metadata.timestamp });
    void cdp.send('Page.screencastFrameAck', { sessionId });
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await act();
  await cdp.send('Page.stopScreencast');
  if (frames.length < 2) throw new Error(`${name}: no frames`);
  const dir = join(tmpdir(), `reymenta-${name}-frames`);
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir);
  // ffmpeg concat list: each frame lasts until the next one (the screencast only sends frames when something changes)
  let list = '';
  frames.forEach((f, i) => {
    const file = join(dir, `${String(i).padStart(4, '0')}.jpg`).replace(/\\/g, '/');
    writeFileSync(file, Buffer.from(f.data, 'base64'));
    const next = frames[i + 1]?.t ?? f.t + 0.5;
    list += `file '${file}'\nduration ${(next - f.t).toFixed(4)}\n`;
    if (i === frames.length - 1) list += `file '${file}'\n`;
  });
  writeFileSync(join(dir, 'list.txt'), list);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'), '-vf', `fps=${FPS},scale=${W}:${H}`,
    '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-crf', '26', '-preset', 'slow', '-movflags', '+faststart', join(out, `${name}.mp4`)]);
  writeFileSync(join(out, `${name}.jpg`), Buffer.from(frames[Math.floor(frames.length / 2)].data, 'base64'));
  rmSync(dir, { recursive: true, force: true });
  console.log(`${name}.mp4 (${frames.length} frames)`);
}

const browser = await puppeteer.launch({ executablePath: chrome, headless: true,
  args: ['--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'] });
try {
  // the Jam: Synth 1, a melody on the pads at the jam's 110 bpm (eighth notes)
  const jam = await newPage(browser);
  await jam.goto(`${URL}?demo`, { waitUntil: 'networkidle0' });
  await jam.click('button.jam-btn'); await wait(2500);
  if (!await clickText(jam, '.jam-tracks button', 'Synth 1')) throw new Error('no Synth 1 track in the jam (is it open?)');
  await wait(1500);
  const pads = await jam.$$eval('.jam-pad', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }));
  // pad order: row 0 = La5; row 1 = La4 Do5 Re5 Mi5 Sol5; row 2 = La3 Do4 Re4 Mi4 Sol4
  const melody = [6, 8, 9, 3, 2, 9, 8, 6, 7, 8, 1, 3, 4, 5, 0, 4, 3, 1, 9, 8, 6];
  await record(jam, 'music', async () => {
    await wait(400);
    for (const i of melody) {
      const p = pads[i % pads.length];
      await jam.mouse.move(p[0], p[1]); await jam.mouse.down(); await wait(170); await jam.mouse.up(); await wait(100);
    }
    await wait(400);
  });

  // Strudel in the Workshop: the track "ambivalence", Play
  const ws = await newPage(browser);
  await ws.goto(URL, { waitUntil: 'networkidle0' });
  await ws.click('button.workshop-btn:not(.jam-btn)'); await wait(1500);
  await clickText(ws, 'button', 'Morceaux'); await wait(1500);
  if (!await clickText(ws, 'button', 'ambivalence')) throw new Error('no track "ambivalence" in the Workshop');
  await wait(2000);
  await clickText(ws, 'button', 'Strudel'); await wait(4000);
  await ws.$eval('.ws-strudel', (e) => e.scrollIntoView());
  await wait(500);
  // where "700" of the bass's lpf(700) is drawn in the editor, to live-code it while it plays
  const lpfAt = () => ws.evaluate(() => {
    const walker = document.createTreeWalker(document.querySelector('.ws-strudel .cm-content'), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const i = n.textContent.indexOf('700');
      if (i >= 0 && n.parentElement.closest('.cm-line')?.textContent.includes('lpf(700')) {
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 3);
        const b = r.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2];
      }
    }
    return null;
  });
  await record(ws, 'strudel', async () => {
    await wait(600);
    await clickText(ws, '.ws-strudel button', 'Jouer');
    await wait(2000);
    const at = await lpfAt();
    if (at) {
      await ws.mouse.click(at[0], at[1], { clickCount: 2 }); await wait(400);
      await ws.keyboard.type('1400', { delay: 160 }); await wait(500);
      await clickText(ws, '.ws-strudel button', 'Appliquer');
    }
    await wait(3500);
  });
  await clickText(ws, '.ws-strudel button', 'Stop');
} finally {
  await browser.close();
}
