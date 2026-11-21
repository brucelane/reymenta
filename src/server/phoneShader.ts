// The visuals on the phones (2026-11-21): the jam's phones render the playing folder's shader themselves, behind the
// pads, on the song's clock (no video stream: a few kB once per track instead of ~1.5 Mbit/s per phone). This builds
// the fragment shader a phone compiles with WebGL2, the way the WebApp's GLSL pane does (WebApp lib/Utils.ts
// shaderCompiles): "#version 300 es", precision, assets/shadertoy.vd (Cinder's preamble) adapted to WebGL2, then the
// shader with formatShader's rewrites.
// Which shader: the first fbo*.json of the folder whose texture is the audio or nothing (phones get no images, videos or
// slides: those shaders would show black); none -> "" and the phone draws its own ambient shader.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, normalize } from 'node:path';

const FOLDER = /^[A-Za-z0-9 _.-]{1,64}$/;
const MAX_CODE = 60_000;
let preamble: string | undefined;

function readPreamble(assetsGlsl: string): string {
  if (preamble === undefined) {
    try {
      preamble = readFileSync(join(assetsGlsl, '..', 'shadertoy.vd'), 'utf8')
        .replace(/^#version[^\n]*\n/, '')
        .replace(/sampler1D/g, 'sampler2D')
        .replace(/texture2D/g, 'texture');
    } catch {
      preamble = '';
    }
  }
  return preamble;
}

// the WebApp's formatShader (lib/Utils.ts), kept identical
function formatShader(frag: string): string {
  return frag
    .replace(/"/g, '')
    .replace(/mainImage/g, 'main')
    .replace(/out vec4 fragColor,/g, 'void')
    .replace(/in vec2 fragCoord/g, '')
    .replace(/fragCoord /g, 'fragCoord.xy')
    .replace(/gl_FragColor /g, 'fragColor')
    .replace(/uniform vec2 resolution/g, 'uniform vec3 iResolution')
    .replace(/texture2D/g, 'texture');
}

/** The phone shader of a folder: {code, shader file} or {code: ""} (no usable shader: the phone's ambient one). */
export function phoneShader(assetsGlsl: string, folder: string): { code: string; file: string } {
  if (!FOLDER.test(folder) || folder.includes('..')) return { code: '', file: '' };
  const dir = join(assetsGlsl, folder);
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => /^fbo\d+\.json$/i.test(f)).sort((a, b) => parseInt(a.slice(3)) - parseInt(b.slice(3)));
  } catch {
    return { code: '', file: '' };
  }
  for (const f of files) {
    let json: { shader?: { shadername?: string }; texture?: { texturetype?: string; texturename?: string } };
    try {
      json = JSON.parse(readFileSync(join(dir, f), 'utf8').replace(/^﻿/, ''));
    } catch {
      continue;
    }
    const type = json.texture?.texturetype ?? '';
    if (json.texture?.texturename && type !== 'audio') continue; // an image, a video, a sequence, the camera...
    const name = json.shader?.shadername ?? '';
    if (!/\.(glsl|fs|frag)$/i.test(name)) continue;
    // "name.glsl" in the folder, or "glsl/<other>/name.glsl" from the assets root
    const path = normalize(name.includes('/') ? join(assetsGlsl, '..', name) : join(dir, name));
    if (!path.startsWith(normalize(join(assetsGlsl, '..'))) || !existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    if (text.length > MAX_CODE) continue;
    return { code: `#version 300 es\nprecision highp float;\n${readPreamble(assetsGlsl)}\n${formatShader(text)}`, file: name };
  }
  return { code: '', file: '' };
}
