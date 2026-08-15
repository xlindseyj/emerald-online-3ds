# Emerald Online 3DS

Clean-room homebrew framework for a dual-screen, online-capable monster-RPG on Nintendo 3DS. This repository intentionally contains no Pokemon ROM, game source code, trademarks, maps, dialogue, graphics, audio, or other copyrighted game data. You must supply any legally obtained inputs yourself; do not distribute generated game data.

## Current milestone

- Actual Emerald gameplay, saves, battles, and audio run through a pinned gpSP ARM dynarec core on the top screen. Physical testing on an Old 3DS XL now reaches 60 FPS.
- The native lower screen provides online status, same-map trainers, chat, touch emotes, and a live party summary.
- Online presence includes interpolated trainer overlays, stationary keepalives, and automatic reconnect; offline gameplay remains uninterrupted.
- The server provides validated map rooms, snapshots, rate-limited chat, idle cleanup, health reporting, and automated tests.
- The dedicated renderer uses the full 400x240 top screen and full 320x240 touch screen, with a retained emerald-themed dashboard and live FPS telemetry.
- CIA/3DSX metadata uses the original project icon and custom HOME Menu banner under `assets/`.
- Authentic Brendan/May walking frames and palettes are located and extracted from the user's validated ROM into an ignored SD-only atlas. SaveBlock2 gender selects the avatar; no sprite pixels are embedded in the CIA or sent to the server.

The native gpSP runtime now boots reliably on physical hardware. During bring-up we fixed the CIA/Luma SVC bootstrap, a null libretro capability-probe dereference, a double-VBlank 30 FPS limiter, the padded/tiled GPU upload used by the 400x240 top display, ctrulib's unreliable nonblocking `select()` completion path, a 65536/32768 Hz NDSP mismatch, and the gpSP RAM binding used for Emerald state. An Old 3DS XL now runs at 60 FPS with smooth audio, authenticates with the LAN server, and publishes live map/tile position updates.

The presence server and installer site run on Kubernetes under `deploy/`. The public site is [pokemon.lws-workspace.com](https://pokemon.lws-workspace.com), and gameplay uses the Cloudflare-tunneled, TLS-authenticated WebSocket endpoint `wss://pokemon-server.lws-workspace.com/game`. Raw TCP remains cluster-internal for trusted LAN development. The runtime resolves DNS periodically and accepts either the public WSS transport or an explicitly configured raw-TCP endpoint.

This is a functional prototype, not yet a production multiplayer service. See [ROADMAP.md](ROADMAP.md) for the remaining work.

## Run the server

Requires Node.js 20 or newer. Install the locked dependencies with `npm ci`.

```sh
node server/src/server.mjs
```

Defaults: TCP game protocol on `0.0.0.0:3210`, HTTP health endpoint on `0.0.0.0:3211`. Configure with `GAME_HOST`, `GAME_PORT`, and `HEALTH_PORT`.

```sh
npm test
```

The public web/bridge process runs separately in the same Kubernetes pod:

```sh
PUBLIC_BASE_URL='https://pokemon.lws-workspace.com' \
GAME_PUBLIC_URL='wss://pokemon-server.lws-workspace.com/game' \
node web/install-server.mjs
```

## Inspect your private ROM

ROM files are ignored by Git. Validate the cartridge dump locally with:

```sh
node tools/inspect-rom.mjs "Pokemon - Emerald Version.gba"
```

The inspector reads only the GBA header and computes a hash. A later importer will write derived content under the ignored `generated/` directory.

## Build the 3DS runtime

The actual-game runtime statically links the GPL-2.0-only gpSP 3DS dynarec but never embeds the ROM. Its exact corresponding source is vendored under `third_party/gpsp` and included in each release source archive. On Linux, build it and prepare an ignored, private SD-card directory with:

```sh
npm run build:private
```

On Windows, the PowerShell private-package build remains available:

```powershell
.\scripts\build-runtime.ps1 -RomPath ".\Pokemon - Emerald Version.gba" -TrainerName May
```

Copy the contents of `generated/sd-card` to the SD root. The runtime expects the private ROM and generated `online.cfg` at `sd:/3ds/emerald-online-3ds/`. The build defaults to `pokemon-server.lws-workspace.com`, port `443`, transport `wss`, and path `/game`. Generate a package with a unique `TrainerName` for each 3DS. The build creates and preserves a private `session` token so reconnects retain the same public trainer identity; use a different token on every 3DS. `online.cfg` can be edited later without rebuilding the application. A legacy file containing the former default `192.168.0.25:3210` is migrated in memory to the public endpoint by runtime 0.3.1; deliberate custom LAN endpoints remain supported with `transport=tcp`.

## Install the CIA by QR code

The ROM and `online.cfg` must first be copied to the SD path above. Open the public installer page:

[https://pokemon.lws-workspace.com](https://pokemon.lws-workspace.com)

On the 3DS, open FBI and choose **Remote Install → Scan QR Code**. The QR points directly to the public `emerald-online-3ds.cia`; no ROM data, save, session token, or private avatar content is served. For an offline/LAN install fallback, `npm run install-page` starts the same page locally.

Emerald uses the normal GBA controls. `X` toggles online/offline, `Y` switches the lower screen between the online and party pages, tapping above the bottom row opens same-map chat, and the four bottom touch zones send Wave, Battle, Trade, or GG emotes. Gameplay is permanently locked to the native 400x240 top screen. When offline, the dashboard shows the configured endpoint and latest socket error number. HOME exits. Online failure never stops local gameplay. Set `page=party` in `online.cfg` to open on the party page.

See [TESTING.md](TESTING.md) for emulator and physical-3DS smoke tests.

## Architecture

The server is deliberately content-agnostic. The client owns local simulation and sends a compact presence state; the server validates sequence, position, and map membership, then broadcasts map snapshots. Battles, trades, persistence, authentication, content import, and a production-grade authoritative simulation are later milestones.
