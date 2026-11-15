#!/usr/bin/env node
// Google Play phone screenshots: node scripts/store-shots.mjs
// Starts the audience server (MDNS=0) and the page (vite, http), opens it in the installed Chrome (headless,
// puppeteer-core from ../TSWebsocketServer) at 360x640 CSS px x3 = 1080x1920, with ?demo (simulated tilt),
// and writes store/google-play/phone/1-join-fr.png, 2-play-fr.png, 3-join-en.png, 4-play-en.png.
// 4 fake phones join first, so the room isn't empty. Everything started is stopped at the end.

import { spawn } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, '..', 'TSWebsocketServer', 'package.json'));
const puppeteer = require('puppeteer-core');
const out = join(root, 'store', 'google-play', 'phone');
mkdirSync(out, { recursive: true });

const CHROMES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const chrome = CHROMES.find((p) => existsSync(p));
if (!chrome) { console.error('no Chrome/Edge found'); process.exit(1); }

const children = [];
const start = (cmd, args, env = {}) => {
  const c = spawn(cmd, args, { cwd: root, shell: false, stdio: 'ignore', env: { ...process.env, ...env } });
  children.push(c);
  return c;
};
const stopAll = () => {
  for (const c of children) {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
    else c.kill('SIGTERM');
  }
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(url, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* not yet */ }
    await wait(500);
  }
  throw new Error(`${url} didn't answer`);
}

try {
  // node directly: through pnpm, tsx exits at once when started without a terminal
  const tsx = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  start('node', [tsx, 'src/server/main.ts'], { MDNS: '0' });
  start('node', [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--strictPort']);
  await waitFor('http://127.0.0.1:5191/ping');
  await waitFor('http://localhost:5192/');
  start('node', [tsx, 'scripts/fake-phones.ts', '4']);
  await wait(2000);

  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--hide-scrollbars'] });
  // Play's three screenshot sets, portrait (the app is held upright): phone, 7" and 10" tablets
  const DEVICES = [
    { dir: 'phone', width: 360, height: 640, scale: 3 },        // 1080x1920
    { dir: 'tablet-7', width: 600, height: 960, scale: 2 },     // 1200x1920
    { dir: 'tablet-10', width: 800, height: 1280, scale: 1.5 }, // 1200x1920
  ];
  const shot = async (device, lang, n) => {
    const folder = join(root, 'store', 'google-play', device.dir);
    mkdirSync(folder, { recursive: true });
    const page = await browser.newPage();
    await page.setViewport({ width: device.width, height: device.height, deviceScaleFactor: device.scale, isMobile: true, hasTouch: true });
    await page.evaluateOnNewDocument((l) => { localStorage.setItem('reymenta:lang', l); }, lang);
    await page.goto('http://localhost:5192/?demo', { waitUntil: 'networkidle0' });
    await wait(500);
    await page.screenshot({ path: join(folder, `${n}-join-${lang}.png`) });
    await page.click('button.big');
    await wait(2500); // welcome, a few demo tilts
    await page.screenshot({ path: join(folder, `${n + 1}-play-${lang}.png`) });
    await page.close();
  };
  for (const device of DEVICES) {
    await shot(device, 'fr', 1);
    await shot(device, 'en', 3);
  }
  await browser.close();
  console.log(`screenshots in ${join(root, 'store', 'google-play')}: ${DEVICES.map((d) => d.dir).join(', ')}`);
} catch (e) {
  console.error(e);
  process.exitCode = 1;
} finally {
  stopAll();
  setTimeout(() => process.exit(), 1500);
}
