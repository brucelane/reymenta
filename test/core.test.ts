import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { computeBars, fretBass } from '../src/core/songGrid';
import { MODES } from '../src/core/scales';

const CORE_FILES: string[] = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'src', 'core', 'files.json'), 'utf8'));
const webapp = join(import.meta.dirname, '..', '..', 'WebApp', 'src', 'lib');

test('src/core is the same as the WebApp (run `pnpm sync-core` after a WebApp change)', { skip: !existsSync(webapp) && 'no ../WebApp here' }, () => {
  for (const f of CORE_FILES) {
    assert.equal(readFileSync(join(import.meta.dirname, '..', 'src', 'core', f), 'utf8'), readFileSync(join(webapp, f), 'utf8'), `${f} differs`);
  }
});

test('the core modules load in this repo', () => {
  assert.equal(typeof computeBars, 'function');
  assert.equal(typeof fretBass, 'function');
  assert.ok(Object.keys(MODES).length > 5);
});
