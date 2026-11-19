// The WebApp's pure modules (no DOM framework, no server) copied into src/core (2026-11-19, studies/reymenta-workshop.md
// step 2): the bass tab model and fingering (songGrid), scales and key guess, the playable-bass rule (bassist), patch
// lengths and sections (strudelLength), MIDI files, Ableton set reading. The WebApp is the source: edit there, then
// `pnpm sync-core` here. Copied, not linked: this repo is public and built by GitHub (the SWA workflow), where
// ../WebApp doesn't exist. test/core.test.ts fails when a copy differs from the WebApp's (when ../WebApp is there).
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CORE_FILES = ['songGrid.ts', 'scales.ts', 'bassist.mjs', 'strudelLength.ts', 'midiFile.ts', 'alsImport.ts'];
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const from = join(root, '..', 'WebApp', 'src', 'lib');
const to = join(root, 'src', 'core');

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!existsSync(from)) { console.error(`no ${from}: run this where the WebApp sits next to reymenta`); process.exit(1); }
  mkdirSync(to, { recursive: true });
  for (const f of CORE_FILES) copyFileSync(join(from, f), join(to, f));
  writeFileSync(join(to, 'files.json'), `${JSON.stringify(CORE_FILES)}
`);
  writeFileSync(join(to, 'README.md'), `# src/core\n\nCopies of the WebApp's \`src/lib/\` modules (${CORE_FILES.join(', ')}), made by \`pnpm sync-core\`.\nDon't edit them here: edit the WebApp's and sync again. \`test/core.test.ts\` checks they're the same.\n`);
  console.log(`copied ${CORE_FILES.length} files from ${from}`);
}
