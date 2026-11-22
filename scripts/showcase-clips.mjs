#!/usr/bin/env node
// Join-screen carousel clips (web/src/Showcase.tsx): node scripts/showcase-clips.mjs [phones=10] [seconds=6]
// Renders the big-screen audience visuals in headless Chrome (WebGL2, puppeteer-core from ../TSWebsocketServer),
// driven by simulated phones that move like scripts/fake-phones.ts (slow tilt waves, a shake now and then,
// touches), frame by frame at 30 fps, then encodes with ffmpeg:
//   web/public/showcase/eyes.mp4 + eyes.jpg      ../assets/glsl/audiencetest/audience_eyes.glsl, as Cinder runs it
//   web/public/showcase/circles.mp4 + circles.jpg one circle per phone in the audience grid (studies/reymenta-audience.md
//                                                 "Layout of the circles"), its hue, moved by its tilt: drawn here,
//                                                 Cinder's per-phone circles pass doesn't exist yet
// No server needed: the uniforms the audience server would send (iAud0..8, iAud16..31) are computed here.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, '..', 'TSWebsocketServer', 'package.json'));
const puppeteer = require('puppeteer-core');
const PHONES = Number(process.argv[2] ?? 10);
const SECONDS = Number(process.argv[3] ?? 6);
const FPS = 30, W = 640, H = 360;
const out = join(root, 'web', 'public', 'showcase');
mkdirSync(out, { recursive: true });

const CHROMES = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const chrome = CHROMES.find((p) => existsSync(p));
if (!chrome) { console.error('no Chrome/Edge found'); process.exit(1); }

const eyesSrc = readFileSync(join(root, '..', 'assets', 'glsl', 'audiencetest', 'audience_eyes.glsl'), 'utf8');

// one circle per phone, in the audience grid, like each phone's own play screen (a glowing disc in its hue)
const circlesSrc = `
uniform vec4 uPh[16];   // per phone: tilt x, tilt y (-1..1), shake, touch
uniform float uHue[16];
vec3 hsl(float h, float s, float l) { vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return l + s * (k - 0.5) * (1.0 - abs(2.0 * l - 1.0)); }
void main(void) {
  vec2 uv = gl_FragCoord.xy / iResolution.xy;
  float aspect = iResolution.x / iResolution.y;
  float n = max(1.0, floor(iAud0 * 64.0 + 0.5));
  float cols = n <= 1.0 ? 1.0 : n <= 3.0 ? n : n <= 9.0 ? 3.0 : ceil(sqrt(n));
  float rows = ceil(n / cols);
  vec3 c = vec3(0.02, 0.02, 0.03);
  for (int i = 0; i < 16; i++) {
    float id = float(i);
    if (id >= n) break;
    float row = floor(id / cols), col = id - row * cols;
    float inRow = row == rows - 1.0 ? n - row * cols : cols;
    vec2 centre = vec2((col + 0.5 + (cols - inRow) * 0.5) / cols, 1.0 - (row + 0.5) / rows);
    vec4 ph = uPh[i];
    float cell = min(1.0 / cols * aspect, 1.0 / rows);   // the cell's size in height units
    centre += vec2(ph.x / cols, -ph.y / rows) * 0.32;
    vec2 d = (uv - centre) * vec2(aspect, 1.0);
    float r = cell * (0.16 + 0.07 * ph.z + 0.03 * clamp(iFreq0 / 60.0, 0.0, 1.0));
    float dist = length(d);
    vec3 hue = hsl(uHue[i] / 360.0, 0.9, 0.6);
    c += hue * (1.0 - smoothstep(r - 0.004, r + 0.004, dist));                 // the disc
    c += hue * 0.55 * exp(-max(dist - r, 0.0) / (cell * 0.09));               // its glow
    c += vec3(1.0) * ph.w * smoothstep(0.006, 0.0, abs(dist - r * 1.35));       // a ring while touching
  }
  fragColor = vec4(c, 1.0);
}`;

const page = `<!doctype html><html><body style="margin:0;background:#000">
<canvas id="c" width="${W}" height="${H}"></canvas>
<script>
const gl = document.getElementById('c').getContext('webgl2', { preserveDrawingBuffer: true });
const N = ${PHONES};
let h = 1; const rnd = () => (h = (h * 16807) % 2147483647) / 2147483647;   // seeded: the same clip each run
const phones = Array.from({ length: N }, () => ({ phase: rnd() * 6.283, speed: 0.35 + rnd() * 0.5, hue: Math.floor(rnd() * 360) }));
const head = '#version 300 es\\nprecision highp float;\\nuniform vec3 iResolution;\\nuniform float iTime, iFreq0;\\n'
  + Array.from({ length: 32 }, (_, i) => 'uniform float iAud' + i + ';').join('\\n') + '\\nout vec4 fragColor;\\n';
function program(src) {
  const sh = (type, s) => { const o = gl.createShader(type); gl.shaderSource(o, s); gl.compileShader(o);
    if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, '#version 300 es\\nin vec2 a;void main(){gl_Position=vec4(a,0.,1.);}'));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, head + src));
  gl.linkProgram(p); return p;
}
const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 3,-1, -1,3]), gl.STATIC_DRAW);
const progs = { eyes: program(${JSON.stringify(eyesSrc)}), circles: program(${JSON.stringify(circlesSrc)}) };
// what the phones send (fake-phones.ts' motion, smoothed for the camera) and what the audience server makes of it
function room(t) {
  const ph = phones.map((p, i) => {
    const s = Math.sin(t * 0.45 + p.phase);
    return {
      tx: Math.sin(t * p.speed + p.phase), ty: Math.cos(t * p.speed * 0.7 + p.phase),
      sh: s > 0.8 ? (s - 0.8) / 0.2 : 0,
      to: Math.sin(t * 0.6 + p.phase * 2) > 0.85 ? 1 : 0,
      fx: 0.5 + 0.35 * Math.sin(t * 0.9 + i), fy: 0.5 + 0.35 * Math.cos(t * 0.7 + i * 2),
    };
  });
  const avg = (f) => ph.reduce((a, p) => a + f(p), 0) / ph.length;
  const touching = ph.filter((p) => p.to);
  const u = { iAud0: N / 64, iAud1: avg((p) => (p.tx + 1) / 2), iAud2: avg((p) => (p.ty + 1) / 2), iAud3: avg((p) => p.sh),
    iAud4: touching.length / N, iAud6: Math.max(0, Math.sin(t * 0.8)) * 0.6,
    iAud7: touching.length ? touching.reduce((a, p) => a + p.fx, 0) / touching.length : 0.5,
    iAud8: touching.length ? touching.reduce((a, p) => a + p.fy, 0) / touching.length : 0.5,
    iFreq0: 60 * Math.pow(Math.max(0, Math.cos(t * Math.PI * 2)), 6) };   // a kick at 120 bpm
  ph.slice(0, 8).forEach((p, i) => {   // each of the first 8 phones' own look: finger while touching, else tilt
    u['iAud' + (16 + i * 2)] = p.to ? p.fx : (p.tx + 1) / 2;
    u['iAud' + (17 + i * 2)] = p.to ? p.fy : (p.ty + 1) / 2;
  });
  return { u, ph };
}
window.frame = (name, t) => {
  const p = progs[name]; gl.useProgram(p);
  const loc = gl.getAttribLocation(p, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, ${W}, ${H});
  const { u, ph } = room(t);
  gl.uniform3f(gl.getUniformLocation(p, 'iResolution'), ${W}, ${H}, 1); gl.uniform1f(gl.getUniformLocation(p, 'iTime'), t);
  for (const [k, v] of Object.entries(u)) gl.uniform1f(gl.getUniformLocation(p, k), v);
  if (name === 'circles') {
    gl.uniform4fv(gl.getUniformLocation(p, 'uPh'), new Float32Array(16 * 4).map((_, j) => { const q = ph[j >> 2]; return q ? [q.tx, q.ty, q.sh, q.to][j & 3] : 0; }));
    gl.uniform1fv(gl.getUniformLocation(p, 'uHue'), new Float32Array(16).map((_, j) => phones[j]?.hue ?? 0));
  }
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  return gl.canvas.toDataURL('image/png');
};
</script></body></html>`;

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const tab = await browser.newPage();
  tab.on('pageerror', (e) => console.error(e.message));
  await tab.setViewport({ width: W, height: H });
  await tab.setContent(page);
  for (const name of ['eyes', 'circles']) {
    const dir = join(tmpdir(), `reymenta-${name}-frames`);
    rmSync(dir, { recursive: true, force: true }); mkdirSync(dir);
    const start = 12;   // a few seconds in: the phones have spread out
    for (let f = 0; f < SECONDS * FPS; f++) {
      const url = await tab.evaluate((n, t) => window.frame(n, t), name, start + f / FPS);
      writeFileSync(join(dir, `${String(f).padStart(4, '0')}.png`), Buffer.from(url.split(',')[1], 'base64'));
    }
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-framerate', String(FPS), '-i', join(dir, '%04d.png'), '-an', '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-crf', '24', '-preset', 'slow', '-movflags', '+faststart', join(out, `${name}.mp4`)]);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', join(dir, '0045.png'), '-q:v', '4', join(out, `${name}.jpg`)]);
    rmSync(dir, { recursive: true, force: true });
    console.log(`${name}.mp4`);
  }
} finally {
  await browser.close();
}
