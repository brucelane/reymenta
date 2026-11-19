#!/usr/bin/env node
// pnpm deploy:android (2026-11-19): the Android app built and installed on the phone plugged in over USB, without
// opening Android Studio. Same script in reymenta and WebApp (copy it when it changes). Windows and macOS.
//   pnpm deploy:android              web build, cap sync, gradle assembleDebug, adb install -r, then start the app
//   pnpm deploy:android --release    web build, cap sync, gradle bundleRelease: the signed AAB for Google Play
//                                    (android/keystore.properties, git-ignored); prints its path and versionCode
//   pnpm deploy:android --no-build   skips the web build (only sync + gradle + install)
// JAVA_HOME: Android Studio's bundled JBR unless already set. adb: ANDROID_HOME / ANDROID_SDK_ROOT, else the SDK's
// default place (Windows %LOCALAPPDATA%\Android\Sdk, macOS ~/Library/Android/sdk), else adb on the PATH.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const release = args.includes('--release');
const skipBuild = args.includes('--no-build');
const win = process.platform === 'win32';
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function run(cmd, cmdArgs, cwd = root, env = process.env) {
  console.log(`\n> ${cmd} ${cmdArgs.join(' ')}`);
  const r = spawnSync(cmd, cmdArgs, { cwd, stdio: 'inherit', env, shell: win });
  if (r.status !== 0) { console.error(`failed: ${cmd} ${cmdArgs.join(' ')} (exit ${r.status})`); process.exit(r.status ?? 1); }
}

const env = { ...process.env };
if (!env.JAVA_HOME) {
  const jbr = win ? 'C:\\Program Files\\Android\\Android Studio\\jbr' : '/Applications/Android Studio.app/Contents/jbr/Contents/Home';
  if (existsSync(jbr)) env.JAVA_HOME = jbr;
}
const sdk = env.ANDROID_HOME || env.ANDROID_SDK_ROOT || (win ? join(env.LOCALAPPDATA ?? '', 'Android', 'Sdk') : join(homedir(), 'Library', 'Android', 'sdk'));
const adbPath = join(sdk, 'platform-tools', win ? 'adb.exe' : 'adb');
const adb = existsSync(adbPath) ? adbPath : 'adb';

if (!skipBuild) run('pnpm', ['build']);
run('npx', ['cap', 'sync', 'android']);

const android = join(root, 'android');
// the full path: cmd may not look in the current folder (NoDefaultCurrentDirectoryInExePath), so a bare gradlew.bat
// wasn't found (2026-11-19); quoted for paths with spaces
const gradlew = win ? `"${join(android, 'gradlew.bat')}"` : './gradlew';
if (release) {
  if (!existsSync(join(android, 'keystore.properties'))) console.warn('no android/keystore.properties: the bundle will not be signed with the upload key');
  run(gradlew, ['bundleRelease'], android, env);
  const aab = join(android, 'app', 'build', 'outputs', 'bundle', 'release', 'app-release.aab');
  const [y, m, d, n] = pkg.version.split('.').map(Number);
  console.log(`\nAAB for Google Play: ${aab}\nversion ${pkg.version}, versionCode ${y * 1000000 + m * 10000 + d * 100 + n} (bump the version before the next upload)`);
  process.exit(0);
}

run(gradlew, ['assembleDebug'], android, env);
const apk = join(android, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const devices = spawnSync(adb, ['devices'], { encoding: 'utf8', shell: win }).stdout ?? '';
if (!/\tdevice\b/.test(devices)) {
  console.log(`\nNo phone in 'adb devices' (USB debugging on? cable?). The APK is ready: ${apk}`);
  process.exit(0);
}
run(adb, ['install', '-r', apk]);
// start it: the package id from capacitor.config (appId)
const cfg = readFileSync(join(root, 'capacitor.config.ts'), 'utf8');
const appId = /appId:\s*['"]([^'"]+)['"]/.exec(cfg)?.[1];
if (appId) spawnSync(adb, ['shell', 'monkey', '-p', appId, '-c', 'android.intent.category.LAUNCHER', '1'], { stdio: 'ignore', shell: win });
console.log(`\nInstalled and started ${appId ?? 'the app'} (${pkg.version}).`);
