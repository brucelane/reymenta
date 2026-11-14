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
                              Cinder: uniforms iAud0..iAud31 (indexes 200..231)
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
pnpm dev           # the phone page, https on the LAN: https://<this PC's address>:5192
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

## Licence

AGPL-3.0-or-later (see LICENSE). Hydra and Strudel, planned for later, are AGPL too.
