// The phone's background shader (src/server/phoneShader.ts, 2026-11-21), on the real assets folders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { phoneShader } from '../src/server/phoneShader';

const glsl = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'glsl');

test('a folder with an audio texture: its fbo0 shader, ready for WebGL2', () => {
  const s = phoneShader(glsl, 'engulfing');
  assert.equal(s.file, 'engulfing_descent.glsl');
  assert.match(s.code, /^#version 300 es\nprecision highp float;\n/);
  assert.match(s.code, /uniform float\s+iFreq0/); // Cinder's preamble included
  assert.match(s.code, /void main\(\)/);
});

test('the slides folder (images only): no shader, the phone draws its own', () => {
  assert.deepEqual(phoneShader(glsl, 'ableton'), { code: '', file: '' });
});

test('names that could escape the folder are refused', () => {
  assert.equal(phoneShader(glsl, '../TSWebsocketServer').code, '');
  assert.equal(phoneShader(glsl, 'no-such-folder').code, '');
});
