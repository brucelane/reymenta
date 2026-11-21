// The show's visuals behind the jam (2026-11-21): the phone renders the playing folder's shader itself (the server
// sends it once per folder, ready for WebGL2: src/server/phoneShader.ts) on the song's clock (the same {t:"clock"} as
// the tab view). No video stream. Cheap on purpose: a third of the screen's resolution, 30 frames a second, nothing
// while the page is hidden, dimmed by CSS so the pads stay readable. No shader (a folder of images or videos), or one
// the phone can't compile: an ambient shader of its own, in the phone's colour.
import { useEffect, useRef } from 'react';
import type { ShaderMsg } from '../../../src/room/protocol';
import type { ClockAt } from '../TabView';

const SCALE = 1 / 3;
const FRAME_MS = 1000 / 30;
const BEATS_PER_CYCLE = 4;

const VERTEX = `#version 300 es
in vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

// the ambient fallback: slow waves of light in the phone's hue, pulsing on the beat
const AMBIENT = `#version 300 es
precision highp float;
uniform vec3 iResolution;
uniform float iTime, iBeat, iHue;
out vec4 fragColor;
vec3 hsv(float h, float s, float v) { vec3 k = clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0); return v * mix(vec3(1.0), k, s); }
void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
  float pulse = exp(-4.0 * fract(iBeat));
  float w = sin(uv.x * 3.0 + iTime * 0.4) + sin(uv.y * 4.0 - iTime * 0.3) + sin(length(uv) * 6.0 - iTime * 0.8);
  float l = 0.15 + 0.12 * w + 0.25 * pulse * smoothstep(1.2, 0.0, length(uv));
  fragColor = vec4(hsv(iHue / 360.0 + 0.05 * w, 0.8, clamp(l, 0.0, 1.0)), 1.0);
}`;

/** where the song is now, from the last clock: seconds and beats (extrapolated while it plays) */
function songAt(clock: ClockAt | undefined, now: number): { seconds: number; beats: number } {
  if (!clock || clock.msg.s <= 0) return { seconds: now / 1000, beats: (now / 1000) * 2 };
  const cycles = clock.msg.c + (clock.msg.p ? ((now - clock.at) / 1000) * clock.msg.s : 0);
  return { seconds: cycles / clock.msg.s, beats: cycles * BEATS_PER_CYCLE };
}

function compile(gl: WebGL2RenderingContext, fragment: string): WebGLProgram | null {
  const make = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('[vis]', gl.getShaderInfoLog(s)?.slice(0, 300)); return null; }
    return s;
  };
  const v = make(gl.VERTEX_SHADER, VERTEX), f = make(gl.FRAGMENT_SHADER, fragment);
  if (!v || !f) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, v);
  gl.attachShader(prog, f);
  gl.bindAttribLocation(prog, 0, 'p');
  gl.linkProgram(prog);
  return gl.getProgramParameter(prog, gl.LINK_STATUS) ? prog : null;
}

export default function VisBackground({ shader, clock, hue }: { shader?: ShaderMsg; clock?: ClockAt; hue: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const hueRef = useRef(hue);
  hueRef.current = hue;

  useEffect(() => {
    const cv = canvas.current;
    const gl = cv?.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!cv || !gl) return;
    const prog = (shader?.code && compile(gl, shader.code)) || compile(gl, AMBIENT);
    if (!prog) return;
    gl.useProgram(prog);
    // a full-screen triangle pair
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // every sampler reads a dark 1x1 texture (no images, video or audio texture on a phone)
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([20, 20, 24, 255]));
    const u = (name: string) => gl.getUniformLocation(prog, name);
    const f1 = (name: string, v: number) => { const l = u(name); if (l) gl.uniform1f(l, v); };
    // Cinder's defaults for what the show's shaders read (VDUniforms), set once
    f1('iWeight0', 1); f1('iZoom', 1); f1('iAlpha', 1); f1('iRatio', 20); f1('iExposure', 1); f1('iSpeed', 1);
    const color = u('iColor'); if (color) gl.uniform3f(color, 0.45, 0, 1);
    const steps = u('iSteps'); if (steps) gl.uniform1i(steps, 16);

    let raf = 0, last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (document.hidden || now - last < FRAME_MS) return;
      last = now;
      const w = Math.max(1, Math.round(cv.clientWidth * devicePixelRatio * SCALE));
      const h = Math.max(1, Math.round(cv.clientHeight * devicePixelRatio * SCALE));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; gl.viewport(0, 0, w, h); }
      const { seconds, beats } = songAt(clockRef.current, now);
      const pulse = Math.exp(-4 * (beats % 1));
      const res = u('iResolution'); if (res) gl.uniform3f(res, w, h, 1);
      const rs = u('RENDERSIZE'); if (rs) gl.uniform2f(rs, w, h);
      f1('iTime', seconds); f1('TIME', seconds);
      f1('iBeat', beats); f1('iBar', Math.floor(beats / BEATS_PER_CYCLE)); f1('iHue', hueRef.current);
      const bpm = clockRef.current ? clockRef.current.msg.s * 60 * BEATS_PER_CYCLE : 120;
      f1('iBpm', bpm); f1('iTempoTime', seconds);
      // no audio on the phone: the levels follow the beat (a kick-like pulse low, faster ones higher up)
      f1('iFreq0', 200 * pulse); f1('iFreq1', 140 * Math.exp(-6 * ((beats * 2) % 1)));
      f1('iFreq2', 90 * Math.exp(-8 * ((beats * 4) % 1))); f1('iFreq3', 60 * Math.exp(-10 * ((beats * 4) % 1)));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      gl.deleteProgram(prog);
      gl.deleteBuffer(buf);
      gl.deleteTexture(tex);
    };
  }, [shader?.f, shader?.code]);

  return <canvas ref={canvas} className="jam-vis" aria-hidden />;
}
