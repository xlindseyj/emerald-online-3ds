# Emerald Online 3DS

Clean-room homebrew framework for a dual-screen, online-capable monster-RPG on Nintendo 3DS. This repository intentionally contains no Pokemon ROM, game source code, trademarks, maps, dialogue, graphics, audio, or other copyrighted game data. You must supply any legally obtained inputs yourself; do not distribute generated game data.

## Current milestone

- Actual Emerald gameplay, saves, battles, and audio run through a pinned gpSP ARM dynarec core on the top screen. An earlier Old 3DS XL baseline reached 60 FPS; the current Gate 4 run is 48-52 FPS, so performance acceptance remains open.
- The native lower screen provides a grouped Online/Adventure/Social/System launcher, context-aware nearby/chat/link/quest prompts, a paged global roster, switchable session-only Map and Global Chat, touch emotes, local-only adventure tools, and explicit-consent statistics.
- Online presence includes interpolated trainer overlays, stationary keepalives, and automatic reconnect; offline gameplay remains uninterrupted.
- Operator-spawned test trainers remain stationary on a real player's exact observed starting tile. The server stores no ROM-derived collision map and does not infer synthetic movement from coordinates that omit surfing, elevation, collision, and object-priority state; moving-trainer acceptance uses a real second client.
- Remote trainers are still composited after Emerald's completed framebuffer, so valid movement behind a sign or tree canopy may appear in front of that foreground object. Restoring Emerald-like sprite/foreground priority without sending ROM-derived map data is tracked separately.
- Protocol v2 silently enrolls each installation with a server-issued UUID and 256-bit device credential, stores it separately in private `identity.cfg`, and offers a one-time recovery code plus export, revocation, recovery, and deletion.
- The server provides validated map rooms, snapshots, rate-limited chat, idle cleanup, health reporting, automated tests, durable identity storage, a paired community forum, private player profiles, consented leaderboards, and idempotent official release publishing in a two-instance PostgreSQL cluster.
- Cluster-internal Prometheus metrics, an authenticated Grafana dashboard, and a safety-bounded concurrent load harness cover service capacity without exposing player identifiers or game data.
- The dedicated renderer uses the full 400x240 top screen and full 320x240 touch screen, with a retained emerald-themed dashboard and live FPS telemetry.
- CIA/3DSX metadata uses the original project icon and custom HOME Menu banner under `assets/`.
- Authentic Brendan/May walking frames and palettes are located and extracted from the user's validated ROM into an ignored SD-only atlas. SaveBlock2 gender selects the avatar; no sprite pixels are embedded in the CIA or sent to the server.

The native gpSP runtime now boots reliably on physical hardware. During bring-up we fixed the CIA/Luma SVC bootstrap, a null libretro capability-probe dereference, a double-VBlank 30 FPS limiter, the padded/tiled GPU upload used by the 400x240 top display, ctrulib's unreliable nonblocking `select()` completion path, a 65536/32768 Hz NDSP mismatch, and the gpSP RAM binding used for Emerald state. An earlier Old 3DS XL baseline reached 60 FPS with smooth audio, but the latest recorded Gate 4 hardware run was consistently 48-52 FPS; 60 FPS is still the acceptance target. Version 0.8.9 adds frame-timing instrumentation, asynchronous GPU framebuffer upload, decoupled emulation/rendering frame pacing, and network-offload improvements aimed at reaching stable 60 FPS, while retaining switchable Map and Global Chat, larger list text, a tap-to-read full-message view, the global read-only user roster, local-only Bag and Map/Radar pages, Gate 3 profiles, privacy controls, leaderboards, readable network diagnostics, validated progressed-save handoff, Azahar interpreter/network stability fixes, and strict overworld-only remote-trainer rendering. The opt-in link experiment uses gpSP's Emerald RFU backend and has completed a native two-Azahar Union Room trade through animation, automatic save, restart, and exchanged-party verification. A subsequent two-Azahar battle reached the native LINZ-versus-CODEX screen but one peer received Emerald's communication error, so battle acceptance remains blocked. Testers must use Emerald's Wireless Club / Union Room route; the Direct Corner is not supported by this experimental path. The runtime verifies Emerald's active main callback and battle flag before reading or drawing presence, so stale map coordinates cannot place online trainers over battles, menus, native multiplayer rooms, or other scenes. The Bag reads item names from the user's private validated ROM and decrypts local quantities in memory; none of that data is uploaded or packaged. The experimental link room is disabled by default, accepts exactly two authenticated clients, and refuses to start the gpSP netpacket session unless a timestamped save backup has been flushed and fsynced. Public invitations and battle/trade rankings remain disabled pending physical battle, trade, interruption, save-integrity, audio, latency, and performance acceptance.

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

Emerald uses the normal GBA controls. `X` toggles online/offline and `Y` opens a grouped lower-screen launcher. The launcher keeps Online, Adventure, Social, and System pages discoverable; use touch or the D-pad to choose a page, `L`/`R` to change groups, and `A` to open it. Party and Bag data stay local to the console. Online Users is a read-only, touch-paged global roster with each connected trainer's current map and tile coordinates; opaque IDs are retained internally so future row actions can be added without changing the feed. Chat has touch buttons for Map Chat and Global Chat. Both are session-only, show the sender and server UTC timestamp, and use larger three-row pages; tap a row to read the complete message, or Compose to send to the selected scope. The server does not store routine chat. The Bag page has touch tabs for Items, Key Items, Poké Balls, TM/HM, and Berries plus page navigation; the Map page shows current coordinates, facing, a short movement trail, and same-map nearby trainers. Tapping the Online trainer profile card opens browser-pairing entry, tapping the left or right dashboard panel opens Online Users or Chat, and the four bottom touch zones send Wave, Battle, Trade, or GG emotes. The Stats page uploads nothing by default: enabling it requires typing `YES` after all four fields are named, each field can be disabled independently, and deleting server history requires typing `DELETE`. Gameplay is permanently locked to the native 400x240 top screen. When offline, the dashboard shows the configured endpoint and latest socket error number. HOME exits. Online failure never stops local gameplay. Set `page=online`, `users`, `chat`, `party`, `bag`, `map`, `stats`, `quest`, `titles`, `friends`, `guild`, `teleport`, or `update` in `online.cfg` to choose the initial lower page.

## Windows desktop launcher

A one-click Windows installer is built from the `desktop/` directory. It shows a branded animated title screen and launches the project runtime inside the Azahar emulator so Windows users get the same dual-screen layout as on a 3DS.

### Install

Download `EmeraldOnline3DS-Setup-<version>.exe` from a release and run it. The installer creates Start Menu and desktop shortcuts. It does **not** contain a Pokémon ROM.

### First launch

1. Open the launcher. The title screen displays the project banner and an animated emerald background.
2. Click **Continue**. Because no ROM is configured yet, a file picker opens.
3. Select your legally obtained Pokémon Emerald (U) `.gba` dump. The launcher validates the ROM header and hash, then copies it into a private application data directory.
4. Click **Play** to launch Azahar and start playing. The launcher hides while the game is open and returns when Azahar closes.

### Controls

- Arrow keys = Circle Pad / movement
- A = GBA A / confirm
- S = GBA B / back
- M = Start
- N = Select
- Z = toggle online mode (3DS X)
- X = open/close the grouped lower-screen launcher (3DS Y); Q/W change groups
- Q / W = L / R
- F10 = switch screen layout
- F11 = fullscreen

Click the emulated lower screen for touch controls. Gamepads are supported through Azahar's input configuration.

### Settings

Click the gear icon on the title screen to change:

- Trainer name (1–12 printable ASCII characters)
- Server host, port, transport (`wss` or `tcp`), and WebSocket path
- Whether online mode is enabled
- The starting lower-screen page

Online mode defaults to the production server `wss://live.emeraldonline3ds.com/game`. Disable it to play offline, or point it at a local LAN server.

The launcher validates the configured ROM again before every start, never logs or uploads its path or contents, and keeps the Azahar profile, ROM, save, identity, updateable working 3DSX, and preferences under the launcher's private application-data directory. **Data & recovery** can create and restore a local-only `.eobackup`, open the directory, export redacted diagnostics, or delete the launcher's private data. Backups include only the save, identity, settings, optional avatar atlas, and link-save backups; the ROM, runtime, update downloads, and debug log are always excluded. Because a backup can contain the online identity, keep it private.

Launcher update checks run only when requested. A newer Windows installer is downloaded only from `https://emeraldonline3ds.com`, must match the SHA-256 value returned by `/api/release`, and must have a valid Windows Authenticode signature before the launcher offers to open it. In-game 3DSX updates continue to persist across launches; a newer desktop installer replaces only an untouched launcher-managed runtime. Uninstalling preserves private data to prevent accidental save loss; use **Delete all local data** for a complete application-level cleanup. Filesystem and SSD behavior mean deletion is not claimed as forensic secure erasure.

The Windows build requires 64-bit Windows 10 or newer, an SSE4.2-capable x86-64 processor, at least 2 GB RAM (4 GB recommended), and OpenGL 4.3 or Vulkan 1.1 graphics support. The installer includes the pinned official Azahar 2126.0 portable runtime and the ROM-free Emerald Online 3DS 3DSX; users do not need Node.js or a separate emulator installation.

### Build the installer locally

```powershell
# From the repository root on Windows
cd desktop
npm install

# Development mode (requires AZAHAR_PATH or resources/azahar/azahar.exe)
npm start

# Production installer (requires the 3DSX in release/ and Azahar in resources/azahar/)
npm run dist
```

The root `npm run build:desktop` script installs desktop dependencies and produces `desktop/dist/EmeraldOnline3DS-Setup-<version>.exe`.
The build fails when the runtime, emulator DLLs/plugins, license notices, or privacy audit are incomplete. Configure the repository secrets `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD` with the production code-signing certificate. Tagged `v*` CI builds fail if those secrets are absent or if either the installed application executable or NSIS installer does not have a valid Authenticode signature. Local, branch, and pull-request artifacts may remain unsigned, but the in-app updater will reject them.

See [TESTING.md](TESTING.md) for emulator, physical-3DS, and desktop smoke tests.

## Publish a release

Release notes are structured in `release/release-catalog.json`, and confirmed official defects in `release/known-issues.json`. `npm run build:public` synchronizes current CIA, 3DSX, and source hashes, while `npm run audit:release` validates forum content, media, and the privacy-minimized source package. The homepage version comes from `package.json`, which must match the newest release entry. Deployment idempotently publishes official release and known-issue topics and pins only the newest release. See [RELEASE_PUBLISHING.md](RELEASE_PUBLISHING.md).

## Architecture

The server is deliberately content-agnostic. The client owns local simulation and sends a compact presence state; the server validates sequence, position, map membership, and device authentication, then broadcasts same-map snapshots plus a separate global list limited to display name, map, and tile coordinates. PostgreSQL persists identity and community metadata plus explicitly consented aggregate scores, never Trainer ID, Pokémon, moves, ROM/save/party/inventory data, or routine chat. Save-derived boards are labeled `Community-submitted`; compatibility reports are `Server-observed`; anomalous claims are held `Under review` while the last accepted score remains visible. Battle and trade rankings stay disabled until peer-confirmed physical result detection exists. The paired forum, profiles, and leaderboards are live at [emeraldonline3ds.com/community](https://emeraldonline3ds.com/community). See [COMMUNITY_PLATFORM_PLAN.md](COMMUNITY_PLATFORM_PLAN.md).
