# Hardware smoke test

The current 0.5.0 actual-game runtime defaults to `wss://live.emeraldonline3ds.com/game`; `online.cfg` can change that without rebuilding. It contains the gpSP 3DS ARM dynarec core but no ROM data.

- 3DSX SHA-256: `cf41213268f190603f6616c1fcb79f56790537f00a2dd4e48c334361083d68d6`
- CIA SHA-256: `d4b32e28b8bf79360897208a660b7f8b9e68d1255c062603890219125d7c0ced`
- Corresponding-source SHA-256: `0a2a1113444d5591bb6ae7bc25bf42af4c917c96321187718f23035790367806`
- Private avatar atlas SHA-256: `ab3f08aec7b8598f383e5032e22d3ea2a5234522230d460b908a2e3517d753d8`

## Latest physical result (2026-08-15, protocol-v2 WSS test)

- Console: blue Old Nintendo 3DS XL.
- Boot/dynarec: pass. The CIA reaches Emerald through gpSP without the earlier ARM11 stack dump.
- Performance: pass at 60 FPS after removing a redundant VBlank wait; the previous build was capped near 29 FPS.
- Audio: pass. NDSP now adopts gpSP's configured 32768 Hz rate after content loading, eliminating the earlier block gaps and choppiness.
- Bottom screen: pass. The 320x240 emerald dashboard renders correctly.
- Top screen: full 400x240 coverage and vertical orientation are confirmed. The latest uploaded build removes the remaining horizontal mirror; normal left-to-right orientation still needs one final confirmation.
- LAN network: pass. The Old 3DS XL reports `ONLINE`; server telemetry confirms one connected client, one authenticated client, and one accepted protocol `hello`.
- Public WSS network: the first physical 0.4.0 runs reached online startup but reported `E71` (`EPROTO`). The first fix made HTTP header-name parsing case-insensitive, but the error remained. An exact production-WSS run in Azahar then reproduced `stage=3 tls=-9984 verify=00000200`: the 3DS local wall clock is interpreted as UTC, so Cloudflare's newly issued certificate appeared four hours in the future. The current build accepts only `MBEDTLS_X509_BADCERT_FUTURE`, only when the not-before time is within the 14-hour civil-timezone range; hostname, signature, trust-chain, expiry, and all other checks remain mandatory. The 0.5.0 gpSP build enrolled through `wss://live.emeraldonline3ds.com/game` both before and after the Gate 2 deployment, and each synthetic identity was deleted. The physical device still has the earlier header-only build; 0.5.0 transfer and acceptance are pending ftpd availability.
- Overworld RAM bridge: pass. The dashboard reports map/tile data and the server confirms one positioned trainer, one active room, and multiple accepted state updates.
- Authentic remote avatars: Brendan rendering is confirmed on the physical Old 3DS XL using a synthetic same-map peer. The private build found Brendan graphics/palette at ROM offsets `0x4975F8`/`0x4987F8` and May at `0x4A3078`/`0x4A4278`, then produced an SD-only 18-frame atlas. SaveBlock2 also correctly published the test save's selected boy avatar. May and a two-physical-client exchange remain to be confirmed.
- Automated suite: 25 passing, with two PostgreSQL tests skipped unless `TEST_DATABASE_URL` is supplied. Both durable-store tests pass against disposable PostgreSQL 17, including migration 002 and the complete pairing/forum/defect/report/sanction lifecycle.
- Live community: pass. A synthetic production-WSS 3DS identity approved a browser pairing, created a paired-only beta topic and reply, remained hidden to anonymous readers, and exposed no internal identity UUID. The topic and identity were then removed and the database confirmed zero synthetic rows.
- Headless emulator: pass with official Azahar 2126.0 on Linux. The 0.5.0 smoke persisted a server-issued identity, retained it across reconnect, stayed online while stationary, automatically reconnected, republished state, and separately enrolled through the real production WSS endpoint. Physical hardware remains authoritative for the mbedTLS/SD path.

Current artifacts are `994240` bytes (CIA), `1252212` bytes (3DSX), `2234726` bytes (corresponding source), and `4257` bytes (`avatars.t3x`). The private 3DS package includes the ROM and atlas; the public release never does. Reinstall the CIA after every replacement; overwriting `/cias/emerald-online-3ds.cia` does not update an already installed HOME Menu title.

## Automated Linux verification

Run `npm ci`, `npm test`, `npm run build:public`, and `npm run audit:release`. With the ignored official Azahar AppImage and project-local Xvfb dependencies prepared, `npm run smoke:emulator` performs the network/reconnect smoke without a desktop session. Physical Old 3DS behavior remains the release authority for performance, controls, Wi-Fi, audio, and HOME lifecycle.

## Optional LAN server smoke

1. Connect the workstation and 3DS to the same Wi-Fi/LAN.
2. Run `node server/src/server.mjs` from the repository root.
3. Verify `http://127.0.0.1:3211/health` reports `{"ok":true,...}`.
4. If Windows Firewall prompts, allow Node.js on **Private networks only**. TCP port 3210 must be reachable from the 3DS.

## Prepare the 3DS

1. Build a private package with a unique name, for example `.\scripts\build-runtime.ps1 -TrainerName May`, then copy the contents of `generated/sd-card` to the SD root. This directory contains the application, configuration, and your validated ROM; do not redistribute it.
2. Start it from Homebrew Launcher.
3. Confirm Emerald boots directly on the top screen, including audio, and the bottom screen shows the native trainer panel.
4. Confirm the top image fills the complete 400x240 display and the lower emerald dashboard fills 320x240 without blue gaps, clipping, or flicker. Record the dashboard FPS after the intro and again in the overworld.
5. Start or continue a save and enter the overworld. Confirm the lower screen changes from `Waiting for the overworld` to plausible map and tile values, which update as you walk.
6. With Wi-Fi connected, confirm the mode automatically reaches `ONLINE` through `live.emeraldonline3ds.com:443`. On first enrollment, write down the one-time recovery code and confirm `identity.cfg` appears beside `online.cfg`. Press `X` to disconnect (`OFFLINE`) and again to reconnect with the same displayed fingerprint.
7. Open `https://emeraldonline3ds.com/community` in a browser and choose Pair. While the game is online, tap the trainer profile card on the bottom screen, enter the displayed five-minute code, and confirm the browser becomes paired. Verify Beta Testing is readable and create then delete one test topic.
8. Tap the chat panel, enter a short message in the 3DS keyboard, and press Send. Confirm the keyboard closes and the message appears on the lower panel.
9. With another client in the same map, tap each lower-edge emote button: `WAVE`, `BATTLE`, `TRADE`, and `GG`. Confirm the matching colored indicator appears briefly above your trainer on the other client. Confirm rapidly repeated taps are rate-limited without interrupting play.
10. Leave the player stationary online for at least 45 seconds and confirm the status remains `ONLINE`.
11. Disable Wi-Fi briefly. Confirm the panel changes to `RETRYING` while Emerald keeps running. Restore Wi-Fi and confirm it returns to `ONLINE` without pressing X or moving.
12. Press `Y` and confirm the native party page shows each party nickname, level, and current/maximum HP. Damage or heal a party member and confirm HP updates without reopening the page. Press `Y` again to return online status.
13. Save through Emerald's normal menu, close using HOME, relaunch, and confirm the save loads.

## CIA QR installation

1. Copy the private ROM and `online.cfg` from `generated/sd-card/3ds/emerald-online-3ds/` to the same path on the SD card first.
2. Open `https://emeraldonline3ds.com` on a phone or workstation.
3. On FBI, choose **Remote Install**, then **Scan QR Code**, and scan the page's QR code.
4. Confirm installation, launch the HOME Menu title, and repeat the gameplay/network checks above.
5. If using the public page, verify `https://emeraldonline3ds.com/health` reports `ok: true`, protocol `2`, and database `ready`. For the optional local page, verify both devices are on the same LAN and allow Node.js or TCP 8080 on the Windows private-network firewall profile.

## Two-client presence test

Run the same build on a second 3DS (or one 3DS plus Azahar) and enter the same map on both. Each lower screen should name the other trainer, coordinates, facing, and show `Nearby trainers: 1`; entering different maps should return the count to zero. Once the local runtime has observed each facing direction, nearby remote trainers should use the transparently decoded Emerald trainer sprite for that direction. A magenta silhouette is the safe fallback before a direction has been captured. Walk one tile at a time and confirm the remote sprite glides rather than teleports. Send chat from each system and confirm it appears only while both are on the same map.

Record console model, system version, Homebrew Launcher version, each pass/fail result, and any crash/error screen. Real hardware is authoritative for Wi-Fi and lifecycle behavior.

## Container and Kubernetes server

`docker build -t emerald-online-3ds:test .` must send only the Node application
and the ROM-free CIA. No ROM, save, identity/config file, private avatar atlas,
or private 3DSX may appear in an image layer. Start the presence and web commands
in one network namespace, verify `/health`, complete a WebSocket `hello`/`welcome`
exchange, and confirm the served CIA hash. Validate `deploy/kubernetes.yaml`
before applying it to the cluster.

## Rebuild the public package

```powershell
.\scripts\build-runtime.ps1 -RomPath ".\Pokemon - Emerald Version.gba" -TrainerName May
```

The generated `online.cfg` holds the server hostname, port, transport, path, and trainer-name fallback and can be edited without rebuilding. The server-issued credential is created separately in `identity.cfg`. For a trusted LAN override, pass `-ServerHost`, `-ServerPort`, and `-Transport tcp`.
