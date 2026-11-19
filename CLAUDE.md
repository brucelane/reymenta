# reymenta

The audience side of the Reymenta AV set (23 January 2027): a phone page and an audience server that turns the
room's tilt/shake/touch/emoji into Cinder uniforms `iAud0..iAud31` (260..291). Overview, decisions and the plan:
`../studies/reymenta-audience.md`. How to run: `README.md`.

- Git `main`, GitHub `brucelane/reymenta` (public; the 2014 repo of that name, its old history deleted on 2026-11-14).
- TypeScript, pnpm, Vite + React (plain CSS), `ws`. AGPL-3.0-or-later. Version `Y.M.D.N` (6.11.14.1), bumped
  on every change (the user's rule for every repo).
- `src/room/`: pure room logic shared by the server and, later, the browser `/screen` demo: `protocol.ts`
  (messages, validation: everything from a phone is untrusted), `layout.ts` (1 centered, row of 3, 3x3, 4x4...),
  `names.ts` (FR/EN animal names from the phone id, no typing), `room.ts` (join/leave/timeout, emoji rate,
  aggregates; `AUD` maps the iAud indexes).
- `src/server/`: `main.ts` (phones on `/ws`, 20 msg/s cap per phone, values to Cinder 20 times a second when
  changed, `GET /status`), `cinder.ts` (client of TSWebsocketServer as `app=mid`, reconnects).
- `web/`: the phone page (join, FR/EN, motion permission from the tap, tilt/shake/touch at ≤10 msg/s when
  changed, emoji row, wake lock). `pnpm dev` = https on the LAN (`@vitejs/plugin-basic-ssl`), `/ws` proxied.
- `scripts/fake-phones.ts` (`pnpm bots N`), `scripts/make-icons.ps1` (icons from `web/public/logo.png`, the
  ReyMenta logo from `C:\ReyMenta\ReyMentaLogo.png`).
- Cinder: `iAud0..31` added in Cinder-VDR `VDUniforms` (2026-11-14), declared in `assets/shadertoy.vd`, named in
  the WebApp's `cinderUniforms.ts`. Test shader: `assets/glsl/audiencetest`.

## History

- 2026-11-14: created on the Acer. Milestone 1 (LAN, end to end): checked with 30 fake phones -> server ->
  TSWebsocketServer -> a stand-in Cinder (`app=vdc`): 676 iAud values in 9 s, `/status` count 30. `pnpm test`
  5/5, `pnpm build` 61 KB gzipped. Not tried yet: a real phone (https page on the LAN), the real Cinder with
  `audiencetest`. Icons and splash sources generated from the logo.

- 2026-11-15: Android app (Capacitor 8, server discovery via capacitor-lan + mDNS `_reymenta._tcp`), Google Play prep (signed AAB, upload key in `%USERPROFILE%\.android-keys`, store graphics and phone/tablet screenshots, listing texts, privacy policy at assets.batchass.fr/reymenta/privacy.html), `pnpm bump`. **The app was set up on Google Play by the user (2026-11-15).** Next on Play: the closed test (12 testers opted in for 14 days in a row) before production can be requested.

- 2026-11-15: cloud path (Azure Web PubSub `sophiaantipolis`, hub `reymenta`, room `reymenta` in `.env`) checked end to end: `scripts/cloud-check.ts` joined through Azure and got its welcome from the audience server. SWA created by the user (Free, GitHub deployment, workflow `.github/workflows/azure-static-web-apps-zealous-island-06f2fc203.yml` committed by the portal): deployed on every push to `main`, default address https://zealous-island-06f2fc203.8.azurestaticapps.net; a phone using that `/api/join` got its welcome through Azure (2026-11-15). `live.videodromm.com` live with Azure's certificate the same day (checked by the user, and `/api/join` there).
- 2026-11-19 (6.11.19.1): **the playing bass tab on the phone** (`studies/reymenta-workshop.md` step 1). The audience
  server reads every transport state TSWebsocketServer relays (`cinder.ts` `onRaw`): Cinder's (its position + the
  track's bpm from track.json + the tab's `cycleBeats`) and, since today, the WebApps' (`cycle`, `cps`: their wav or
  their Strudel pane); Cinder wins while fresh (`src/server/tabFollow.ts`). Phones open a "Bass tab" view (header
  button): `{t:"tab",on}` → the track's tab once, compact (`TabMsg`: `[beat, string, fret, dur]`, sections, title;
  ~9 KB for Hex Bolt) and `{t:"clock"}` every second while playing and on every change; only those phones (cloud
  quota). The phone (`web/src/TabView.tsx`) draws 3 bars with a playhead it moves between clocks; the tab view is
  re-requested after a reconnect. Tests `test/tabfollow.test.ts` (19/19 in all); checked against a stand-in
  TSWebsocketServer and phone (tab once, clock 1/s, stop). Not tried on a real phone yet.
- 2026-11-19 (6.11.19.2): **steps 2 and 3 of `studies/reymenta-workshop.md`.** `src/core/`: copies of the WebApp's
  pure modules (songGrid, scales, bassist, strudelLength, midiFile, alsImport) made by `pnpm sync-core`
  (`scripts/sync-core.mjs`); never edit them here, `test/core.test.ts` fails when they differ from the WebApp's.
  **The Workshop** (offline, FR/EN, `web/src/workshop/`, lazy-loaded: 18 KB gzipped, nothing added to the Show
  page): start screen "Show" / "Workshop" (remembered; a QR link always opens the Show); the user's library in
  IndexedDB (localStorage fallback) with export (whole library, or one track.json / tab.json / setlist) and import
  (type detected, replace or keep both, validated); setlists and tracks (public setlists read-only with "copy to
  mine"); bass tab view (`web/src/TabView.tsx`, still mode) and editor (16th grid × 4 strings, number pad, lengths,
  bars, sections; notes outside E1–D3 or on open strings other than low E in orange; files stay `TabData`:
  notes in `song.tracks.tabbass`, strings in `overrides`, `tab` from `fretBass`); fretboard (bass 4/5, guitar 6,
  4 tunings, 12/24 frets, the track's key); artists and About pages. Public catalogue (`catalogue.ts`): the
  audience server's `GET /api/library/<path>` (`src/server/library.ts`, read-only, JSON/PNG, CORS `*`, folder
  `assets/public/library` or `LIBRARY_DIR`), else https://assets.batchass.fr/library/, cached for offline; opening a
  public track copies it into the library. The library itself is built by `live/build-public-library.mjs` (root
  repo), which also writes the bundled offline copy `web/src/workshop/artists.json`. Tests 32/32 (workshop 11);
  clicked through in headless Edge at phone size. Not tried on a phone or in the Android app (downloads from its
  WebView may do nothing; the page says so). BEAD tuning listed but disabled (`fretBass` is 4-string).
- 2026-11-19 (6.11.19.3): **step 4: Strudel and the drum tab in the Workshop.** `web/src/workshop/strudelEngine.ts`
  (a slim copy of the WebApp's engine: `@strudel/web/web.mjs` 1.3.0 + soundfonts 1.3.0, 10 s per sound list, the
  audio resumed inside the click, `.early()`, the end of a full track, `.bassist()`), `StrudelSection.tsx` (CodeMirror,
  Play/Stop, bar n/N, scrub + section buttons, import/export `.strudel.js`, revert to the public original; the bass tab
  follows the playing bar; code from a file or the catalogue runs only on Play), `drums.ts` + `DrumSection.tsx` (a drum
  grid per bar, 16 kits, toggles, generated `s(arrange(...)).bank(kit)` code, "read the drums from the patch" by
  querying its haps, "add to the patch"). The library keeps `patches` and `drums`. `@strudel/core/mini/transpiler`
  1.2.6 are dev dependencies for the Node tests only (one engine copy in the bundle). Sizes gzip: Show 69.8 KB, the
  Workshop's first screen 25 KB, the Strudel chunk 364 KB (+19 KB soundfonts). Tests 39/39; clicked through in headless
  Edge (Ambivalence plays and its bass tab follows; its drums read as 136 bars). Not heard on a real phone yet.
- 2026-11-19 (6.11.19.4): **step 5: Hydra in the Workshop.** `web/src/workshop/HydraSection.tsx` (hydra-synth 1.4.0,
  AGPL, `makeGlobal: false`; canvas under a CodeMirror overlay with adjustable opacity; Ctrl+Enter line/selection,
  Alt+Enter block, Ctrl+Shift+Enter all, Ctrl+Shift+H hide code; Run / Hide / Mic buttons; code from a file or the
  catalogue runs only on Run; the microphone only after a tap; nothing runs when the section is closed),
  `hydraComplete.ts` (52 functions with parameters and defaults read from hydra-synth's `glsl-functions.js`, snippets
  + a parameter hint), `hydraShortcuts.ts` (the user's 32 Ctrl+Space shortcuts from his 2021 editor
  `C:/cpp/hydra/BruceHydrasophiadigitalart.fr/hydra-server/app/src/editor.js`; `ch` calls `chromatic()`, not built into
  Hydra), `hydra.ts` (64 KB cap, a dark starter with the track's bpm, free sketches). Library: `hydra: {<folder>: code}`
  and `sketches: [{id, title, code}]`. Sizes gzip: Show 69.8 KB, Workshop 26.9 KB, Hydra 67.3 KB, CodeMirror 148.8 KB
  (shared with Strudel), Strudel 224.9 KB. Tests 46/46; headless Edge (SwiftShader WebGL) ran it; APK rebuilt and
  installed on the phone. Not tried on a phone GPU yet.

## Next

- Try on real phones (several Android, one iPhone; no Apple developer account needed for the web page) and in
  Cinder with `audiencetest`.
- Cinder audience pass + data texture (per-phone circles and lines), the timeline's Audience routing node,
  `/screen` + solo mode, Azure Web PubSub (`reymenta` hub on `sophiaantipolis`) + `/api/join` on the SWA, PWA
  service worker.
- 2026-11-16: QR code for https://live.videodromm.com (iPhones join through the web page, no iOS app):
  `web/public/qr.png` (512 px, served at `/qr.png` after the next deploy) and `assets/images/reymenta-qr.png`
  (1024 px), shown by the new Cinder folder `assets/glsl/reymentaqr` (copy of `qrcode`: `inputImage.fs`, fbo0's
  image = the QR). Made with the `qrcode` npm package (1.5.4, scratch install, not a dependency). Not in the
  setlist `assets/reymenta.json` yet. The audience server must run (`pnpm server`) for the page to connect.
- 2026-11-16: per-phone look: `iAud16..31` = the first 8 phones' own look (x, y; finger while touching, else tilt;
  0.5 = ahead), in join order (= slot order = the eyes' order). `assets/glsl/audiencetest/audience_eyes.glsl`
  `phoneLook()`: eye i follows phone i, eyes beyond 8 the room average (iAud1/2, 7/8). Test in `test/room.test.ts`
  (9/9); both audiencetest shaders compile in WebGL2 (`pnpm glsl-check`). Tried with 2 phones (an iPhone through
  live.videodromm.com, the Android app on the LAN). Note: stopping a background `npx tsx` leaves its node child
  holding port 5191 (EADDRINUSE on restart): stop the node process itself.
- 2026-11-17: **the gate on `/api/join`** (`studies/show-access.md`): a token only inside the show window and with
  the show's code. SWA application settings: `SHOW_CODE` (required: without it every join answers 503),
  `SHOW_ROOM` (default reymenta, the only room accepted), `SHOW_OPEN_FROM`/`SHOW_OPEN_UNTIL` (ISO with offset;
  tokens end at UNTIL), `SHOW_FORCE` open|closed, `JOIN_ORIGINS`. CORS only for live.videodromm.com, the SWA's
  default address and the app's origins. The page reads `?k=` from the QR, keeps it (`reymenta:k`), removes it
  from the address bar, shows "the room opens at…" (retries every 30 s) or a code field (numeric) on 403.
  `pnpm show-qr [code]` makes a 6-digit code and `assets/images/reymenta-qr-show.png` (QR + the code written
  under it; git-ignored, the assets repo is public), shown by `assets/glsl/reymentaqr`. Tests `test/join.test.ts`
  (13/13 with the others). The LAN path (phones on the show Wi-Fi to the local audience server) has no gate.
- 2026-11-17: **open/close** and **Turnstile**. Audience server: `POST /admin/open|close` (localhost only, with
  TSWebsocketServer's token as `X-Token`), `/status` has `open`; closed = every LAN socket closed, the room's cloud
  phones closed through Web PubSub REST (`closeConnections` on the "out" group and each user, `src/cloud/wps.ts`),
  and any phone that comes back closed at once (cloud: once per phone every 10 s); `SHOW_CLOSED=1` starts closed.
  Checked: 3 fake phones out on close, back on open; a cloud connection cut 0.24 s after the REST call. Operator:
  `live/Show-Access.ps1 status|open|close|window|plan` (the audience server + the SWA settings through az when
  installed, else it prints them). Turnstile: `/api/config` gives the page `TURNSTILE_SITEKEY`; the page runs the
  widget (`web/src/turnstile.ts`, interaction-only, `#turnstile`) and sends `&t=`; `/api/join` checks it with
  Cloudflare when `TURNSTILE_SECRET` is set (`TURNSTILE_SOFT=1` lets phones in if Cloudflare can't be reached).
  Tests 14/14 (Cloudflare mocked).
- 2026-11-17: the whole gate checked on a real phone on mobile data (live.videodromm.com/?k=…): code from the
  link, Turnstile, token, welcome from the audience server (`cloudPhones: 1`). Bug found on the way: the Turnstile
  slot had `id="turnstile"`, which made `window.turnstile` the div (browsers' named access), so joining never
  started; now `#cf-turnstile-slot` and the API checked by `render` being a function (6.11.17.4). Don't give an
  element an id that matches a global a script expects.
- 2026-11-17: tilt didn't work on an old phone: tilt and shake now fall back to the accelerometer's gravity vector
  (`accelerationIncludingGravity`) when the orientation event (gyroscope) doesn't come for a second, or the linear
  acceleration is missing (`web/src/sensors.ts`); `?debug` shows the source (gyro / accel / none) and the values.
  Permission check accepts a phone with DeviceMotionEvent only. Not tried on that phone yet.
- 2026-11-17: the accelerometer fallback for tilt/shake confirmed on the user's old phone.
- 2026-11-17: **emojis on screen.** `iAud9..15` = 😍 🤯 👏 🚀 🌀 💜 🎛️ each on its own (`AUD.each`): every tap adds
  1/`EMOJI_SLOTS` (12), fading with `EMOJI_FADE_MS` (2.5 s, gone after ~7 s); 🔥 stays on `iAud5`. Shader
  `assets/glsl/audiencetest/audience-emojis.glsl` (moved there the same day; the Reymenta folders name it `glsl/audiencetest/audience-emojis.glsl`, which Cinder resolves from the assets root) draws
  one emoji per tap rising like a bubble, from `assets/images/emoji-atlas.png` (`pnpm emoji-atlas`: Noto Emoji
  2D/png/128, Apache 2.0, notice in `emoji-atlas.LICENSE.txt`). Each Reymenta folder has it as its last fbo
  (`fbo8.json` = `iWeight8`; `sky`: `fbo7.json` = `iWeight7`): hidden until that weight is raised (Cinder doesn't
  even render an fbo at weight 0). Also `audiencetest/fbo2.json`. `/status` shows 16 values. Tests 15/15; 10 fake
  phones: values rise per tap and fall back to 0 after they leave. Not seen in Cinder yet.
- 2026-11-17: **the emoji row is hidden until a track opens it.** A track opens it with `"audienceEmojis": true` in
  its `track.json` (set on `audiencetest` only; the Reymenta tracks are off until you add the line). The audience
  server reads Cinder's folder from what TSWebsocketServer relays (folder announcements, transport state:
  `cinder.ts` `onFolder`), then sends `{t:"emojis", on}` to every phone (LAN sockets; cloud: sendToGroup on the
  room's "out" group) and with each welcome; emoji taps are ignored while hidden. Operator override:
  `POST /admin/emojis/on|off|auto` = `live/Show-Access.ps1 emojis on|off|auto`; `/status` has `emojis`. Checked with
  a stand-in Cinder (folder announcements) and a test phone: hidden on join, shown on audiencetest, hidden on polo.
  The emoji shader moved into `assets/glsl/audiencetest/audience-emojis.glsl`.
- 2026-11-17: `pnpm show-qr` draws a **16:9** image (1920x1080: QR left, code large on the right, away from the
  edges): the square one was stretched by Cinder and its code darkened by post.glsl's vignette. Also shown by the new
  `assets/glsl/ableton` folder (the FRAUG talk, fbo 1) on the deck's "Jouez avec nous" slide.
