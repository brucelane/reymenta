#!/usr/bin/env node
// Bumps package.json's version to today: Y.M.D.N (year's last digit, month, day, build of the day).
// 6.11.15.1 -> 6.11.15.2 the same day, -> 6.11.16.1 the next day. `pnpm bump`, before each commit / Play upload.
// The Android versionCode follows (android/app/build.gradle: 6111502), and the app shows the version.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const text = readFileSync(file, 'utf8');
const current = JSON.parse(text).version ?? '';
const d = new Date();
const today = `${d.getFullYear() % 10}.${d.getMonth() + 1}.${d.getDate()}`;
const build = current.startsWith(today + '.') ? Number(current.split('.')[3]) + 1 : 1;
if (build > 99) { console.error('more than 99 builds today: the versionCode would overflow'); process.exit(1); }
const next = `${today}.${build}`;
writeFileSync(file, text.replace(/"version":\s*"[^"]*"/, `"version": "${next}"`));
console.log(`${current} -> ${next}`);
