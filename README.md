# Emerald Online 3DS

Clean-room homebrew framework for a dual-screen, online-capable monster-RPG on Nintendo 3DS. This repository intentionally contains no Pokemon ROM, game source code, trademarks, maps, dialogue, graphics, audio, or other copyrighted game data. You must supply any legally obtained inputs yourself; do not distribute generated game data.

## Current milestone

- Actual Emerald gameplay, saves, battles, and audio run through a pinned gpSP ARM dynarec core on the top screen. An earlier Old 3DS XL baseline reached 60 FPS; the current Gate 4 run is 48-52 FPS, so performance acceptance remains open.
- The native lower screen provides online status, a paged global online-user roster with coordinates, session-only same-map chat history with UTC timestamps, touch emotes, a local-only party summary, and an explicit-consent statistics page.
- Online presence includes interpolated trainer overlays, stationary keepalives, and automatic reconnect; offline gameplay remains uninterrupted.
- Operator-spawned test trainers follow only exact tiles already occupied by a real player. The server stores no ROM-derived collision map and never invents adjacent test positions that could place a sprite in trees, walls, water, or other blocked terrain.
- Remote trainers are still composited after Emerald's completed framebuffer, so valid movement behind a sign or tree canopy may appear in front of that foreground object. Restoring Emerald-like sprite/foreground priority without sending ROM-derived map data is tracked separately.
- Protocol v2 silently enrolls each installation with a server-issued UUID and 256-bit device credential, stores it separately in private `identity.cfg`, and offers a one-time recovery code plus export, revocation, recovery, and deletion.
- The server provides validated map rooms, snapshots, rate-limited chat, idle cleanup, health reporting, automated tests, durable identity storage, a paired community forum, private player profiles, consented leaderboards, and idempotent official release publishing in a two-instance PostgreSQL cluster.
- Cluster-internal Prometheus metrics, an authenticated Grafana dashboard, and a safety-bounded concurrent load harness cover service capacity without exposing player identifiers or game data.
- The dedicated renderer uses the full 400x240 top screen and full 320x240 touch screen, with a retained emerald-themed dashboard and live FPS telemetry.
- CIA/3DSX metadata uses the original project icon and custom HOME Menu banner under `assets/`.
- Authentic Brendan/May walking frames and palettes are located and extracted from the user's validated ROM into an ignored SD-only atlas. SaveBlock2 gender selects the avatar; no sprite pixels are embedded in the CIA or sent to the server.

The native gpSP runtime now boots reliably on physical hardware. During bring-up we fixed the CIA/Luma SVC bootstrap, a null libretro capability-probe dereference, a double-VBlank 30 FPS limiter, the padded/tiled GPU upload used by the 400x240 top display, ctrulib's unreliable nonblocking `select()` completion path, a 65536/32768 Hz NDSP mismatch, and the gpSP RAM binding used for Emerald state. An earlier Old 3DS XL baseline reached 60 FPS with smooth audio, but the current v0.8.3 Gate 4 run is consistently 48-52 FPS; 60 FPS is still the acceptance target. Version 0.8.4 adds the global read-only user roster, session-only timestamped Map Chat list, and a once-per-second cache for save-derived statistics to remove needless per-frame Pokédex scans. It retains the local-only Bag and Map/Radar pages, Gate 3 profiles, privacy controls, leaderboards, readable network diagnostics, the opt-in Gate 4 Serial-Poke feasibility transport, validated progressed-save handoff, Azahar interpreter/network stability fixes, and strict overworld-only remote-trainer rendering. The runtime verifies Emerald's active main callback and battle flag before reading or drawing presence, so stale map coordinates cannot place online trainers over battles, menus, or other scenes. The Bag reads item names from the user's private validated ROM and decrypts local quantities in memory; none of that data is uploaded or packaged. The experimental link room is disabled by default, accepts exactly two authenticated clients, and refuses to start the gpSP netpacket session unless a timestamped save backup has been flushed and fsynced. Public invitations, battle/trade rankings, and completion claims remain disabled pending real Cable Club and physical acceptance.

The presence server and installer site run on Kubernetes under `deploy/`. The public site is [emeraldonline3ds.com](https://emeraldonline3ds.com), and gameplay uses the Cloudflare-tunneled, TLS-authenticated WebSocket endpoint `wss://live.emeraldonline3ds.com/game`. The former hostnames remain temporarily available during migration. Raw TCP remains cluster-internal for trusted LAN development.

This is a functional prototype, not yet a production multiplayer service. See [ROADMAP.md](ROADMAP.md) for the remaining work.

## Run the server

Requires Node.js 20 or newer. Install the locked dependencies with `npm ci`.

```sh
node server/src/server.mjs
```

Defaults: TCP game protocol on `0.0.0.0:3210`, HTTP health endpoint on `0.0.0.0:3211`. Configure with `GAME_HOST`, `GAME_PORT`, and `HEALTH_PORT`. Protocol v1 remains temporarily available without a database for migration testing. Protocol v2 requires either `DATABASE_URL`, or the standard `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD` variables, plus an `IDENTITY_PEPPER` of at least 32 bytes. Run `npm run db:migrate` before the server.

```sh
npm test
```

The public web/bridge process runs separately in the same Kubernetes pod:

```sh
PUBLIC_BASE_URL='https://emeraldonline3ds.com' \
GAME_PUBLIC_URL='wss://live.emeraldonline3ds.com/game' \
node web/install-server.mjs
```

## Inspect your private ROM

ROM files are ignored by Git. Validate the cartridge dump locally with:

```sh
node tools/inspect-rom.mjs "Pokemon - Emerald Version.gba"
```

The inspector reads only the GBA header and computes a hash. A later importer will write derived content under the ignored `generated/` directory.

## Build the 3DS runtime

The actual-game runtime statically links the GPL-2.0-only gpSP 3DS dynarec but never embeds the ROM. Its exact corresponding code is vendored under `third_party/gpsp` and included in each release source archive. The public archive is allow-listed to the 3DS runtime, gpSP source, Makefiles, version, and GPL text: it contains no Markdown, server/deployment configuration, private addresses, operational tooling, screenshots, or branding assets. On Linux, build it and prepare an ignored, private SD-card directory with:

```sh
npm run build:private
```

On Windows, the PowerShell private-package build remains available:

```powershell
.\scripts\build-runtime.ps1 -RomPath ".\Pokemon - Emerald Version.gba" -TrainerName May
```

Copy the contents of `generated/sd-card` to the SD root. The runtime expects the private ROM and generated `online.cfg` at `sd:/3ds/emerald-online-3ds/`. On first v2 connection it creates private `identity.cfg`; preserve that file when updating if you want to retain the same identity. The build defaults to `live.emeraldonline3ds.com`, port `443`, transport `wss`, and path `/game`. `online.cfg` can be edited later without rebuilding the application; deliberate custom LAN endpoints remain supported with `transport=tcp`.

## Install the CIA by QR code

The ROM and `online.cfg` must first be copied to the SD path above. Open the public installer page:

[https://emeraldonline3ds.com](https://emeraldonline3ds.com)

On the 3DS, open FBI and choose **Remote Install → Scan QR Code**. The QR points directly to the public `emerald-online-3ds.cia`; no ROM data, save, identity credential, or private avatar content is served. For an offline/LAN install fallback, `npm run install-page` starts the same page locally.

Emerald uses the normal GBA controls. `X` toggles online/offline and `Y` cycles the lower screen through Online, Online Users, Map Chat, Party, Bag, Map/Radar, and Player Stats. Party and Bag data stay local to the console. Online Users is a read-only, touch-paged global roster with each connected trainer's current map and tile coordinates; opaque IDs are retained internally so future row actions can be added without changing the feed. Map Chat is a touch-paged list of messages from the current map during this runtime session, showing the sender, server UTC timestamp, and message; its Compose button opens the keyboard, and routine chat is not stored by the server. The Bag page has touch tabs for Items, Key Items, Poké Balls, TM/HM, and Berries plus page navigation; the Map page shows current coordinates, facing, a short movement trail, and same-map nearby trainers. Tapping the Online trainer profile card opens browser-pairing entry, tapping the left or right dashboard panel opens Online Users or Map Chat, and the four bottom touch zones send Wave, Battle, Trade, or GG emotes. The Stats page uploads nothing by default: enabling it requires typing `YES` after all four fields are named, each field can be disabled independently, and deleting server history requires typing `DELETE`. Gameplay is permanently locked to the native 400x240 top screen. When offline, the dashboard shows the configured endpoint and latest socket error number. HOME exits. Online failure never stops local gameplay. Set `page=online`, `page=users`, `page=chat`, `page=party`, `page=bag`, `page=map`, or `page=stats` in `online.cfg` to choose the initial lower page.

See [TESTING.md](TESTING.md) for emulator and physical-3DS smoke tests.

## Publish a release

Release notes are structured in `release/release-catalog.json`, and confirmed official defects in `release/known-issues.json`. `npm run build:public` synchronizes current CIA, 3DSX, and source hashes, while `npm run audit:release` validates forum content, media, and the privacy-minimized source package. The homepage version comes from `package.json`, which must match the newest release entry. Deployment idempotently publishes official release and known-issue topics and pins only the newest release. See [RELEASE_PUBLISHING.md](RELEASE_PUBLISHING.md).

## Architecture

The server is deliberately content-agnostic. The client owns local simulation and sends a compact presence state; the server validates sequence, position, map membership, and device authentication, then broadcasts same-map snapshots plus a separate global list limited to display name, map, and tile coordinates. PostgreSQL persists identity and community metadata plus explicitly consented aggregate scores, never Trainer ID, Pokémon, moves, ROM/save/party/inventory data, or routine chat. Save-derived boards are labeled `Community-submitted`; compatibility reports are `Server-observed`; anomalous claims are held `Under review` while the last accepted score remains visible. Battle and trade rankings stay disabled until peer-confirmed physical result detection exists. The paired forum, profiles, and leaderboards are live at [emeraldonline3ds.com/community](https://emeraldonline3ds.com/community). See [COMMUNITY_PLATFORM_PLAN.md](COMMUNITY_PLATFORM_PLAN.md).
