# reymenta

The audience side of the Reymenta AV set (**18 December 2026**, right after the Ableton meeting, as an audiovisual jam; the 23 January 2027 date is cancelled): a phone page and an audience server that turns the
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

## Google Play: installing a test build on a phone

The app (`com.videodromm.reymenta`) isn't public: **Play's search never shows it** until production, even to
testers. A tester gets it only through the track's links, after these steps (release steps and listing:
`store/google-play/listing.md`):

1. **A release on the track.** Play Console > Test and release > Testing > *Internal testing* (or *Closed testing*)
   > Create release > upload the AAB (`pnpm deploy:android --release`; a new versionCode each time) > Save > Review
   > **Start rollout**. Internal: available within minutes, no review. Closed: Google reviews it first (hours to
   days; Publishing overview shows the state).
2. **The list ticked on that track.** Same track > *Testers* tab: creating the email list ("reymenta") isn't
   enough, its **checkbox must be ticked** for this track, then **Save**. Each track (internal, closed) has its own
   tester selection.
3. **The opt-in link.** Same *Testers* tab, "Join on the web" / "Copy link"
   (`https://play.google.com/apps/internaltest/...` for internal, `https://play.google.com/apps/testing/com.videodromm.reymenta`
   for closed). Open it **signed in with the tester's Google account** (batchass06@gmail.com), in the phone's
   browser or on a PC, and tap **Become a tester / Accept**.
4. **Install.** From the opt-in page's "download it on Google Play" link, or
   `https://play.google.com/store/apps/details?id=com.videodromm.reymenta`. The Play Store app on the phone must be
   on **that same account** (avatar top right > switch account). "Item not found" = the account isn't on the list,
   hasn't accepted, or the rollout isn't done yet; wait a few minutes, clear the Play Store's cache, try again.
5. A **debug APK** already on the phone (`pnpm deploy:android`, other signing key) blocks the Play install:
   uninstall it first. Updates then come through the Play Store like any app.

Internal testing (up to 100 testers) is for trying builds; it **doesn't count** toward production access. The
requirement (personal developer account) is the **closed** track: at least 12 testers opted in for 14 days in a
row. The same email list can be ticked on both tracks; the closed track's opt-in link is the one to share.

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
- 2026-11-19 (6.11.19.6): **step 6: exports and grooves.** A track's Exports section (`ExportSection.tsx`,
  `songExport.ts`): MIDI (bass tab, drum tab on channel 10 with GM keys, one track per sound of the patch from its
  haps with note ends; tempo, time signature, sections as markers), Ableton `.als` written in the browser
  (`alsWrite.ts`, a port of TSWebsocketServer's `alsExport.ts` on strings: MIDI tracks only, tempo, locators, 4/4 as the
  template; `als/empty.als` 12 KB in its own chunk; `CompressionStream`), the whole track as one library JSON.
  Grooves (`GroovesScreen.tsx`): strudel-flow (https://app.videodromm.com/, configurable) in an iframe + new tab;
  pasted code plays, goes into a track's patch (`addToPatch`) or starts a track; a strudel-flow JSON is recognised
  (its generator needs strudel-flow's node registry: not ported). Tests 51/51. Not opened in Live or a DAW yet.
  **Release AAB** built the same day for the Google Play closed test (versionCode 6111906).
- 2026-11-20 (6.11.20.1): **tuner, practising the tab, Ableton extras, Link.**
  - Tuner (`web/src/tuner/`: `pitch.ts` McLeod pitch method, 4096-sample window: holds a low B 31 Hz without
    octave jumps; `mic.ts` microphone without echo cancelling / noise suppression / auto gain, own AudioContext;
    `Tuner.tsx` needle ±50 cents, green within ±3, by string or chromatic, the fretboard's instruments/tunings, A4
    432–445, tap a string for its tone). Own chunk (2.3 KB gzip), button on the Show page (next to Bass tab) and in
    the Workshop (home + header 𝄞).
  - Practice section of a track (`PracticeSection.tsx`, `practice.ts`, lazy, 6.9 KB): Play along / Listen / Step.
    The patch chained into a practice pattern (`practiceCode`: parts all / without the bass / bass alone / click,
    bass = `.color("bass")`; `.ribbon` loop of bars or a section; `.late` count-in with a sine click; `.slow` speed
    50–110 %); engine `playRaw`; tab with now/next colours, "now / next" boxes (string, fret, finger), the neck.
    Listen: the microphone against the tab (`Scorer`: ±80 ms before / up to 300 ms after each onset, an octave off
    accepted, latency setting kept, default 150 ms), score per section, bars missed on the last pass → loop one.
    Step: nothing plays, the tab waits for each note (`Stepper`: 3 readings, a repeated note needs a new attack).
    A track with no patch practises over a click at its tempo.
  - Ableton: Exports have a click track (GM 76/77), a count-in bar, a Session scene per section (every clip slot
    list resized, each part's section as a looping clip), and a **practice set** (loop on chosen bars, tempo × speed,
    bass tracks muted, click). Import / export takes an **.als**: its MIDI tracks listed, the bass guessed (name, else
    lowest), the chosen one read as the tab (`alsTab.ts`: renamed "tabbass" in the XML, then core `parseAls`).
    No Drum Rack written: the drums are on GM keys, which Live's kits already follow.
  - Ableton Link (`src/server/link.ts`, optional): `LINK=1 pnpm server` with `@ktamas77/abletonlink` installed by
    hand (`pnpm add -O`, native build; not installed: the install was blocked in the session), Live's Start Stop Sync
    on. A third tab-clock source in `tabFollow.ts` (Cinder > Live playing > WebApp): Link has no song position, so
    Live's start = bar 1 (`LINK_FROM_BAR`), the folder = the last one Cinder/a WebApp named (`LINK_FOLDER`).
    `/status` shows `tabClock` and `link`.
  - Tests 75/75 (practice 9, alstab 3, export +1, tabfollow +1). Not tried yet: a real phone's microphone (tuner,
    listen, step), the sets in Live, Link with Live.
- 2026-11-20 (6.11.20.2): **the Jam** (`../studies/reymenta-jam.md`, for the Ableton meeting): a third start button
  (Show | Jam | Workshop). The phone joins the room as for the Show, then `{t:"jam",on}`; it picks a track
  (`jt`), plays pads (`jn`: held = note on until released), moves knobs (`jk`) and launches clips (`jc`).
  - `src/jam/config.ts`: `jam.json` (default `assets/jam/jam.json`, `JAM_FILE`): MIDI output name, tempo, quantize,
    root + mode, `clipChannel`, up to 12 tracks (notes: octave/octaves/voices; drums: named pads; fx: knobs; each
    with CC knobs and clips = a note on `clipChannel` that the organiser MIDI-maps to a clip slot in Live), validated.
  - `src/jam/jam.ts`: pads over the scale only (`padNote`), a note shared by phones sounds once, `voices` cap per
    track, notes on Link's beat grid (`quantize`, 1/16) when Link has a peer (else at once), note offs after their
    note on, 10 s max hold, a phone leaving releases its notes; knobs = average of the phones moving them (15 s),
    sent as CCs 20/s when changed; clips only those switched on, 2 s cooldown per phone; the organiser's scale
    change ends held notes.
  - Server (`main.ts`): MIDI out through TSWebsocketServer `{"event":"midimsg",port,messages}` (TSWS 6.11.20.1
    added `noteon`/`noteoff` there); closed until `POST /admin/jam/on` (localhost + X-Token like the other admin
    routes; also `off`, `reload`, `clip/<track>/<clip>/on|off`, `scale/<root>/<mode>`) or `JAM_OPEN=1`; state to
    the Jam phones when it changes (2/s max), the beat each second (`jbeat`); `/status` has `jam`.
  - Phone (`web/src/jam/JamView.tsx`, lazy, 3 KB gzip): track list (kind, players), scale pads in rows by octave
    (root in the track's colour, degrees around the hue circle, note names FR/EN, multi-touch, velocity from the
    finger's height), drum pads, clip buttons, knobs (8 msg/s), an XY pad for an effect with 2 knobs, a 4-beat
    pulse.
  - Tests 83/83 (jam 8: one real bug found, the first clip launch refused within 2 s of the clock's origin).
    End to end with the real server, a stand-in TSWebsocketServer and a scripted phone: note on/off, CC, clip,
    a switched-off clip refused, a held note released when the phone left. Not tried: real phones, Live, Link.

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


L'appli qui n'apparaît pas, c'est normal. Tant qu'elle est en test, la recherche Google Play ne la montre jamais, même aux testeurs. Un testeur n'y accède que par les liens du canal de test. Voici comment l'installer sur ton téléphone avec le compte batchass06 :

Publier une version sur le canal de test interne. Dans la Play Console : Tester et publier > Tests > Tests internes > Créer une release. Importe l'AAB, puis Enregistrer > Vérifier > Lancer le déploiement. Les tests internes n'ont pas d'examen : la version est disponible en quelques minutes.
Cocher ta liste sur ce canal. Créer la liste « reymenta » (ta capture) ne suffit pas. Dans l'onglet Testeurs du même canal, coche la case de la liste puis clique sur Enregistrer. Chaque canal a sa propre sélection de testeurs : c'est l'étape qu'on oublie le plus souvent.
Accepter l'invitation. Dans l'onglet Testeurs, copie le lien « Rejoindre sur le Web ». Ouvre-le connecté avec batchass06 et appuie sur Devenir testeur.
Installer. Passe par le lien de cette page, ou par https://play.google.com/store/apps/details?id=com.videodromm.reymenta. L'appli Play Store du téléphone doit aussi être sur batchass06 (touche l'avatar pour changer de compte).
Si tu vois « Article introuvable », une des étapes 1 à 3 n'est pas encore faite. Attends quelques minutes, vide le cache du Play Store et réessaie.
Si un APK de debug installé par pnpm deploy:android est déjà sur ce téléphone, désinstalle-le d'abord. Il est signé avec une autre clé et bloque l'installation depuis Play.
Les tests internes ne comptent pas pour l'accès à la production. Pour ça, il faut toujours le canal de test fermé : au moins 12 testeurs inscrits pendant 14 jours d'affilée. Tu peux cocher la même liste sur le canal fermé et partager le lien d'inscription de ce canal à tes testeurs.
## Fixed (2026-11-21, the play screen's jam and tab overlapped; the Jam open in rehearsals)
- `.play` scrolls (`overflow-y: auto`) instead of squeezing its children; `.jam` keeps its natural height (`flex: 1 0 auto`: `min-height: 0` let it shrink to nothing and its pads were drawn over the tab); `.tab` doesn't shrink and is at most 720 px wide, centred (its SVG rows scaled to the width were huge on a desktop). Checked in headless Chrome at 832×626 (jam + drums track + tab). Version 6.11.21.1.
- Start-Dev (both scripts) starts the audience server with `JAM_OPEN=1` (rehearsals until the event), `-JamClosed` / `--jam-closed` to keep it closed; the organiser still opens it with `POST /admin/jam/on` at the event.
- 2026-11-21 (6.11.21.2): **the show's visuals behind the jam, rendered on the phones** (no video stream, no audio stream: the user, 2026-11-21). Jam phones send `{t:"vis",on}`; the server (`sendVis` in `main.ts`, called with `sendTab`) sends the playing folder's shader once per folder (`{t:"shader",f,code}`, `src/server/phoneShader.ts`: the first fbo*.json whose texture is the audio or nothing, assembled like the WebApp's GLSL pane: `#version 300 es`, precision, `assets/shadertoy.vd` adapted to WebGL2, `formatShader`'s rewrites; "" for a folder of images/videos/slides) and the tab clock. `web/src/jam/VisBackground.tsx` (lazy): full-screen canvas under the jam (`.jam-vis`, opacity 0.45), a third of the resolution, 30 fps, nothing while hidden; `iTime` = song seconds from the clock (extrapolated), `iBeat`/`iBar`/`iBpm`, `iFreq0..3` made from the beat (no audio reaches the audience server), Cinder's defaults (`iWeight0` 1, `iColor`...), every sampler a dark 1×1 texture; no shader or a compile error → an ambient shader in the phone's hue. Tests 86/86 (`test/phoneshader.test.ts`: engulfing gets its fbo0 shader, ableton none, unsafe names refused). Checked in headless Chrome (SwiftShader) at phone size with a fake WebApp clock on `engulfing`: the descent renders behind the pads, no compile error. Not tried on a phone GPU yet.
- 2026-11-21 (6.11.21.3): **Ableton Link installed on the Acer** and on by default: Start-Dev runs the audience server with `LINK=1` (and `JAM_OPEN=1`); `/status` shows `link: {tempo, beat, playing, peers}`. `@ktamas77/abletonlink` 1.2.3 (optional) needed three fixes to build on Windows with Visual Studio 2026: (1) `pnpm add`/`pnpm install` here must use `--ignore-workspace` (pnpm 10.14 fails with "reading 'manifest'" on a pnpm-workspace.yaml without packages); build permission for pnpm 10 in package.json `pnpm.onlyBuiltDependencies` (pnpm 11 reads `allowBuilds` in pnpm-workspace.yaml); (2) `pnpm.overrides` `node-addon-api: 8.0.0` (8.9 doesn't compile in the module's C++14 mode); (3) `patches/@ktamas77__abletonlink@1.2.3.patch` (`pnpm.patchedDependencies`): its binding.gyp defined `LINK_PLATFORM_MACOSX=1` on every OS. node-gyp: the one bundled with Node 22.16 (11.0) doesn't find VS 2026; built with `npx node-gyp@latest rebuild` in the module's folder (no `node-gyp` on PATH, so pnpm's install script fails: after a reinstall, rebuild that way, or `npm i -g node-gyp`). Checked: the module joins the session (tempo 120, 0 peers without Live).
- 2026-11-25 (6.11.25.1): **"audience ended" on the Mac.** pnpm 11 (Mac) runs `pnpm install` before `pnpm run`, and it
  failed: (1) pnpm 11 ignores package.json `"pnpm"` (overrides, patchedDependencies, onlyBuiltDependencies): they're now
  also in `pnpm-workspace.yaml` (pnpm 10.14 on the Acer still needs package.json's: a workspace file without
  `packages` gives it no settings), so both places, same values; (2) the real cause: **lockfiles aren't synced**
  (`.stignore-shared`), and the Mac's was from 2026-11-21, before the Link module. On a machine where pnpm says the
  lockfile doesn't match: take it from git (`git fetch`, `git checkout origin/main -- pnpm-lock.yaml`: safe, the file
  isn't synced), then `pnpm install`.
- 2026-11-26 (6.11.26.1): **avatars.** The user's round drawings on black paper (batchass, scans in
  `C:\repos\import\avatars`) cleaned by `tools/avatars.py` (Python + Pillow + numpy): paper = the most common
  colour among the darker pixels (the ink is lighter; black scanner margins left out), alpha from the colour
  distance, grain blurred, specks removed, the drawing = the main blob + the big ones near the centre, square
  crop, soft round edge, paper unmixed from the colours. Skipped: smaller copies, identical rescans (the numbered
  files duplicating an img/fox scan), `img042` (too faint), `Scan10049` (photo of the whole page). Output
  `assets/avatars/` (512 px webp, `atlas.png` 16×16 cells of 256 px for Cinder, `avatars.json`, README with the
  GLSL lookup); `--publish` copies 256 px versions into `web/public/avatars` (shipped with the page and the app)
  and writes `src/room/avatarCount.ts`. `src/room/avatars.ts`: `avatarFor(id, taken)` = from the phone id like
  the name, skipping avatars already taken in the room; sent in `welcome` (`avatar`, optional), shown next to
  the name in the phone header (glow in the phone's hue). Not sent to Cinder yet (iAud all used: comes with
  the per-phone data texture).
- 2026-11-26 (6.11.26.2): **Workshop and page touches.** The Workshop's home menu has the WebApp's icons
  (`lucide-react` 0.456.0, the WebApp's version: ListMusic, Disc3, Guitar, Sparkles, Workflow, CircleHelp, Download;
  Gauge for the tuner, Users for the artists: no WebApp equivalent). The catalogue line says "local network" or
  "online" instead of the address (`./api/library/` = the audience server's copy, through the dev server's proxy: kept,
  it's what the LAN page and the app on the show Wi-Fi read without internet). The page's "Android app" button became
  "Test the Android app": a mailto to batchass06@gmail.com (subject + body asking for the tester's Google account),
  since Play's search never shows an app in internal test. The Hydra starter sketch is commented line by line
  (+ a soft circle, feedback trails, a microphone hint). Tests 86/87: `core.test.ts` fails because the WebApp's
  `songGrid.ts` changed (run `pnpm sync-core`); not from these changes.
  Jam with no sound: TSWebsocketServer wasn't running (`/status` `cinder: false`), so the Jam's MIDI was dropped;
  started, a scripted phone's Bass pad reached "Default App Loopback (B)" (note on/off, A1, channel 1).
- 2026-11-26 (6.11.26.3): **an "Accueil / Home" button on every page.** The Show and the Jam have it first in the top
  bar (`goHome` in `App.tsx`: leaves the jam and the tab view, stops the sensors, closes the connection, clears the
  room state, back to the start screen); the Workshop's "Show" button became the same "Accueil / Home". Clicked
  through in headless Edge (start → Jam → Home → Workshop → Home); the server's `/status` drops the phone.
- 2026-11-26 (6.11.26.4): **the FRAUG page and the online Jam.**
  - `web/public/fraug/` = https://live.videodromm.com/fraug/ (static, French, no app code): the Ableton User Group
    Côte d'Azur meeting, Friday 18 December 2026 18h, Cyberkiosc, rue de l'Hôtel Dieu (sous la Mairie), 06560
    Valbonne, free entry; programme (Live 13, the .als, sets from code, the Reymenta jam), the Facebook group
    (`groups/french.riviera.ableton`, public, the one Ableton knows; the 23-member group points to it), `fraug.ics`
    (18h-21h: the end time is a guess), Open Graph tags + `og.png` 1200x630 (`python tools/fraug-og.py`, from
    `web/public/logo.png`), schema.org Event. **The Facebook event's address goes in the page's `FB_EVENT` constant**
    (its button stays hidden until then). `staticwebapp.config.json`: `/fraug` redirects to `/fraug/`, `/fraug/*`
    out of the SPA fallback, `.ics` served as text/calendar. Under `pnpm dev` open `/fraug/index.html` (Vite serves
    public folders by exact path only).
  - **Online Jam** (`web/src/jam/online/`, `?jam=online[&room=<code>]`, start screen button; the FRAUG page links
    room `fraug`): up to 5 players at home, no server in the middle. `api/jamjoin` (SWA function, same token code as
    `/api/join`) gives a 1-hour token for hub `jamonline`, group `jam-<room>` (send + join only) and the server's
    clock; refused while the show window is on (`SHOW_OPEN_FROM..UNTIL`, also `JAM_ONLINE=off`). The audience server
    runs the same function for `pnpm dev` (`src/server/jamJoin.ts`, Vite proxies `/api/jamjoin`). Each page runs the
    show's `Jam` class (`onlineRoom.ts`), puts every note on one shared sixteenth grid at least 150 ms ahead (the
    internet's delay hides inside it), sends it to the group and plays the whole room on its own Web Audio synth
    (`synth.ts`: synthesized drums, saw bass with drive, keys, square lead, echo + reverb sends; nothing to
    download). The JamView screen is reused as is. Presence every 8 s (5-player cap kept by the pages: Web PubSub can't
    count a group), the sender = Web PubSub's `fromUserId`, everything from a peer validated (`parsePeerMessage`).
    Quota: the Free tier counts outbound bytes (2 KB units, 20,000 a day) once per receiver; compact wire format
    (~145 bytes a note with Azure's envelope): a busy full room (5 players, 2 notes/s each) is ~10,000 units an hour,
    so about two such hours a day. Tests `test/onlinejam.test.ts` (6). **Checked through the real Azure resource**
    with two headless Edge pages: presence both ways, a Bass pad on page A started the same oscillators on page B,
    both scheduled ahead of their clock. Not tried on phones or by ear yet.
- 2026-11-26 (6.11.26.5): **the online Jam's protection** (the Free tiers can't cost money, they stop at their limits:
  what's protected is the Web PubSub resource the show shares). `api/jamjoin`: Cloudflare Turnstile when
  `TURNSTILE_SECRET` is set (the lobby runs the widget like the show page), at most 6 tokens per address per 10 min
  (function memory, best effort), closed the **whole show day from 00:00 UTC** (the Free tier's daily message count
  restarts then) to `SHOW_OPEN_UNTIL`, and no token lasts into that window. The audience server closes every
  `jamonline` connection on `POST /admin/open` (`closeHub` in `src/cloud/wps.ts`). Pages: a send budget (12 a second,
  24 at once; note offs never blocked) and a flood guard (a peer over 40 note messages in 2 s is muted on that page,
  shown "muted"; its note offs still end its notes). Tests 9 in `onlinejam.test.ts`; two headless pages through Azure
  again after the change.
- 2026-11-26 (6.11.26.6): **roles in the online Jam: 🎹 Music, 🌀 Visuals, ⌨ Strudel** (tabs in the room; presence
  carries the role, the player list shows it).
  - Visuals: Hydra code (starter in `starters.ts`, commented, FR/EN) sent to the room; the latest sent wins and
    becomes everyone's background, driven by the room's notes (`room.kick`, `room.snare`, `room.hat`, `room.bass`,
    `room.keys`, `room.lead`, `room.any`, 0..1, posted to the frame when each note sounds). A "visuals shown/hidden"
    toggle per page.
  - Strudel: each player's part (one `$:` line per pattern), every page plays all parts together on the room's bar
    line (`toNextBar`, cps = bpm/240); `setcps`/`setcpm` lines are overridden by the room's tempo. "Remove my part".
    **strudel-flow** opens inside the Strudel tab (app.videodromm.com); its new **"Send to jam"** button (in its
    code panel, only when embedded: `src/components/editor/pattern-panel.tsx` in `strudel-flow` and `videodromm-swa`)
    posts the code to the page, accepted from that origin only (and localhost:5174), tempo lines stripped, then sent
    with "Send to the room".
  - **Others' code runs only in sandboxed frames**: `web/public/sandbox/hydra.html` and `strudel.html`, loaded in
    `<iframe sandbox="allow-scripts">` (opaque origin: no access to the page, its storage or the room's connection;
    checked: SecurityError from the parent), hydra-synth 1.4.0 and @strudel/web 1.3.0 from jsDelivr with SRI hashes
    (identical to the node_modules copies). The Strudel frame shows a "🔊 Strudel" button when audio needs a tap in
    it. Code messages: 4,000 characters at most, one every 2 s per player, counted by the flood guard; newcomers get
    the playing code from its authors (`greet`).
  - Tests 11 in `onlinejam.test.ts`. **Checked through Azure** with two headless Edge pages: A's Hydra code ran in B's
    sandbox ("ok"), A's Strudel part played in B's ("playing"), roles shown. Not heard or seen on phones yet;
    strudel-flow's "Send to jam" works only once videodromm-swa is deployed (not tried yet).
