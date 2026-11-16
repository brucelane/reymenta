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
