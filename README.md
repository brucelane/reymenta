# Reymenta

The audience plays along with the Reymenta AV set from their phones: tilt, shake, touch and emoji move the
visuals that Cinder renders on the big screen. Built for the French Riviera Ableton User Group Côte d'Azur, 23 January 2027.
Site: `live.videodromm.com` (to come). French / English.

Design and plans: [`studies/reymenta-audience.md`](../studies/reymenta-audience.md) in the parent `repos` folder.

## How it works (milestone 1: on the local network)

```
phones (https page, pnpm dev) --wss /ws--> audience server (pnpm server, :5191)
                                              | the room: places, inputs, emoji -> 32 values 0..1
                                              v
                              TSWebsocketServer (:40088, as a client like the WebApp)
                                              v
                              Cinder: uniforms iAud0..iAud31 (indexes 260..291)
```

Phones never talk to TSWebsocketServer, so nothing they send can become a Cinder command. Later the phones go
through Azure Web PubSub instead of the LAN; the room logic (`src/room`) stays the same.

| iAud | Value (0..1) |
|---|---|
| 0 | participants / 64 |
| 1, 2 | average tilt left/right, front/back (0.5 = flat) |
| 3 | average shake |
| 4 | fraction of phones with a finger down |
| 5 | 🔥 meter (last 10 s) |
| 6 | all emoji activity (last 3 s) |
| 7, 8 | average finger position of the phones touching |
| 9-31 | free |

## Run it

```
pnpm install
pnpm server        # audience server; finds TSWebsocketServer's ACCESS_TOKEN in ../TSWebsocketServer/.env
pnpm dev           # the phone page on this PC: http://localhost:5192
pnpm dev:phone     # the same over https on the LAN, for phones: https://<this PC's address>:5192
pnpm bots 30       # 30 simulated phones, to rehearse alone
```

On a phone, open `https://<PC address>:5192` and accept the self-signed certificate once (the sensors need
https). On the iPhone, Safari asks for the motion permission on "Join". In Cinder, load the `audiencetest`
folder (`assets/glsl/audiencetest`): it shows the 9 values as bars, the room's tilt as a ring, the shake, the
fingers.

`GET http://127.0.0.1:5191/status`: the room as JSON (count, values, TSWebsocketServer connected).

Environment: `PORT` (5191), `HOST` (0.0.0.0), `TSWS_URL` (ws://127.0.0.1:40088), `ACCESS_TOKEN`, `MODE` (circles).

## Other commands

- `pnpm test`: room logic (layout, names, message validation, aggregates).
- `pnpm build`: the static site in `dist/` (for the Azure Static Web App).
- `powershell -File scripts/make-icons.ps1`: favicons, PWA icons and the Capacitor Android icon/splash
  sources (`resources/`) from `web/public/logo.png`.

## Cloud: phones on 4G (Azure Web PubSub + Static Web App)

Phones that aren't on the show's network go through Azure Web PubSub (the existing `sophiaantipolis` resource, hub
`reymenta`, groups `in-<room>` / `out-<room>`). The phone page asks `/api/join` (the SWA's function, `api/join`) for
its address: user id = its phone id, allowed to send to `in-<room>` and listen to `out-<room>` only, 3 hours. The
audience server joins `in-<room>` and answers each phone through the REST API. LAN and cloud phones share one room.

- Which way: the page served from the internet (live.videodromm.com) uses the cloud, a LAN address uses the local
  server; the app uses the local server it found or was given, else the cloud. `?cloud` / `?lan` force it,
  `?room=<name>` picks the room (default `demo`), `?join=<base url>` points at another /api/join.
- The server: `PUBSUB_CONNECTION_STRING` and `ROOM` in `reymenta/.env` (see `.env.example`). `GET /status` shows
  `cloud: true` and the number of cloud phones.
- Check without the SWA: `pnpm server`, then `pnpm tsx scripts/cloud-check.ts` (a phone through the cloud, waits for
  its welcome).
- Tokens are JWTs signed with the access key (`src/cloud/wps.ts`, and the same few lines in `api/join/index.js`):
  no Azure SDK.

**Creating the Static Web App (once, Azure portal):**
1. *Create a resource* > *Static Web App*: plan **Free**, name `reymenta`, region West Europe, source **GitHub**,
   repository `brucelane/reymenta`, branch `main`, build preset **Custom**: app location `/`, API location `api`,
   output location `dist`. The portal commits a GitHub Actions workflow that builds and deploys on every push.
2. The SWA > *Environment variables* (*Configuration*): `PUBSUB_CONNECTION_STRING` = the same connection string.
3. The SWA > *Custom domains* > add `live.videodromm.com`: at IONOS (*Domaines & SSL* > `videodromm.com` > DNS),
   a CNAME `live` -> the SWA's address (`<name>.azurestaticapps.net`), then *Validate* in the portal. Azure gives
   the certificate itself.
4. Check: `https://live.videodromm.com/api/join?id=test-12345678&room=demo` answers `{"url": "wss://..."}`.

## Android app

`pnpm buildandroid`: type-check, build, `npx cap sync android`, then opens Android Studio (Run on a phone over
USB). Capacitor 8, app id `com.videodromm.reymenta`, `http://localhost` scheme + cleartext (LAN). In the app the
page runs from localhost, so the app finds the audience server by itself (`web/src/discovery.ts`: the
address found last time, mDNS `_reymenta._tcp` announced by `pnpm server`, then a scan of the phone's /24 on
port 5191, each answer checked with `GET /ping`), with the plugin `plugins/capacitor-lan` copied from the
WebApp. The join screen shows the address found and lets you type another. The web page doesn't need it.
Windows: allow Node through the firewall on private networks (mDNS is UDP 5353, the server TCP 5191). Icons and splash: `scripts/make-icons.ps1`
redraws `android/app/src/main/res` from the logo (or `pnpm androidassets`, @capacitor/assets). `android/` is
in git but not synced by Syncthing (the shared `android` ignore pattern), like the WebApp's: build it on the
Acer. Without Android Studio: in `android/`, `gradlew.bat assembleDebug` with `JAVA_HOME` set to Android
Studio's `jbr`, then `adb install -r app/build/outputs/apk/debug/app-debug.apk`.
## Licence

AGPL-3.0-or-later (see LICENSE). Hydra and Strudel, planned for later, are AGPL too.
