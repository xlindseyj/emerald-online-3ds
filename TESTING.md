# Hardware smoke test

The current 0.7.1 actual-game runtime defaults to `wss://live.emeraldonline3ds.com/game`; `online.cfg` can change that without rebuilding. It contains the gpSP 3DS ARM dynarec core but no ROM data. Experimental Serial-Poke remains disabled unless `link_room` is explicitly configured. When connection fails, the bottom screen now replaces Nearby/Chat with a readable diagnostic panel; report all four lines, not only `E71`.

- 3DSX SHA-256: `84f9a601839ae6b428eac060dd1b1892db91a2846965e52fc49d9d613f9f7588`
- CIA SHA-256: `a348571370c5abc37a92f0fc1763856b4c6f3913c6a742906decc4e75f6c100e`
- Corresponding-source SHA-256: `a9751a767116ad01b04e90017f988fbf1477ebbcaeab3f071b0f8a68aefd0089`
- Private avatar atlas SHA-256: `ab3f08aec7b8598f383e5032e22d3ea2a5234522230d460b908a2e3517d753d8`

## Latest physical result (2026-08-15, protocol-v2 WSS test)

- Console: blue Old Nintendo 3DS XL.
- Boot/dynarec: pass. The CIA reaches Emerald through gpSP without the earlier ARM11 stack dump.
- Performance: pass at 60 FPS after removing a redundant VBlank wait; the previous build was capped near 29 FPS.
- Audio: pass. NDSP now adopts gpSP's configured 32768 Hz rate after content loading, eliminating the earlier block gaps and choppiness.
- Bottom screen: pass. The 320x240 emerald dashboard renders correctly.
- Top screen: full 400x240 coverage and vertical orientation are confirmed. The latest uploaded build removes the remaining horizontal mirror; normal left-to-right orientation still needs one final confirmation.
- LAN network: pass. The Old 3DS XL reports `ONLINE`; server telemetry confirms one connected client, one authenticated client, and one accepted protocol `hello`.
- Public WSS network: physical runs report `E71` (`EPROTO`) before an application-protocol connection reaches production. An exact production-WSS run in Azahar reproduced `stage=3 tls=-9984 verify=00000200`: the 3DS local wall clock is interpreted as UTC, so a newly issued Cloudflare certificate appeared four hours in the future. The client accepts only `MBEDTLS_X509_BADCERT_FUTURE`, only when not-before is within the 14-hour civil-timezone range; hostname, signature, trust-chain, expiry, and every other check remain mandatory. Release 0.6.1 also corrects the CIA version stamp and displays `v0.6.1` plus the complete `E`, stage, TLS result, verify flags, and accepted skew on-screen. The exact 0.6.1 build enrolls through production WSS in Azahar; physical diagnosis awaits that full on-screen line or ftpd access to `gpsp-debug.log`.
- Overworld RAM bridge: pass. The dashboard reports map/tile data and the server confirms one positioned trainer, one active room, and multiple accepted state updates.
- Authentic remote avatars: Brendan rendering is confirmed on the physical Old 3DS XL using a synthetic same-map peer. The private build found Brendan graphics/palette at ROM offsets `0x4975F8`/`0x4987F8` and May at `0x4A3078`/`0x4A4278`, then produced an SD-only 18-frame atlas. SaveBlock2 also correctly published the test save's selected boy avatar. May and a two-physical-client exchange remain to be confirmed.
- Automated suite: 33 passing against disposable PostgreSQL 17, including migrations 001-003, identity/community lifecycles, per-device consent, validation, anomaly quarantine/review, pagination, opt-out, compatibility contributions, and complete deletion.
- Live community: pass. A synthetic production-WSS 3DS identity approved a browser pairing, created a paired-only beta topic and reply, remained hidden to anonymous readers, and exposed no internal identity UUID. The topic and identity were then removed and the database confirmed zero synthetic rows.
- Gate 3 live lifecycle: pass. A synthetic WSS device consented and uploaded aggregate stats, paired a browser, appeared on a per-release board, confirmed disabled battle/trade rankings, submitted a Server-observed compatibility result, opted one field out, deleted all history, and deleted its identity. Direct database verification then found zero synthetic identities, scores, history, or compatibility reports.
- Headless emulator: pass with official Azahar 2126.0 on Linux. The exact 0.6.0 Gate 3 build persisted a server-issued identity, retained it across reconnect, stayed online while stationary, automatically reconnected, republished state, and enrolled through production WSS again after deployment. The 0.6.1 physical-diagnostics hotfix retains the same network implementation and adds its version plus TLS stage, result, verification flags, and accepted future skew to the bottom screen. Synthetic identities were deleted. Physical hardware remains authoritative for the mbedTLS/SD and touch paths.

Current artifacts are `1001920` bytes (CIA), `1263412` bytes (3DSX), `2311000` bytes (complete first-party and corresponding gpSP source), and `4257` bytes (`avatars.t3x`). The private 3DS package includes the ROM and atlas; the public release never does. Reinstall the CIA after every replacement; overwriting `/cias/emerald-online-3ds.cia` does not update an already installed HOME Menu title.

## Gate 4 experimental link smoke

Automated evidence: two isolated Azahar 2126.0 profiles passed four startup/hard-interruption cycles and retained exactly the newest three save backups per profile. A production-WSS test delivered 53 bounded synthetic packets, recovered from a hard guest disconnect, and measured 164-186 ms round trip (171 ms average) with 4.5 ms mean absolute jitter. Because the available emulator state remained at the title screen and emitted zero Cable Club packets, this is transport evidence only; the battle, trade, save-integrity, real packet-loss, and physical-performance steps below remain required.

1. Preserve an independent copy of both saves. Use release 0.7.1 on both clients.
2. Copy `release/online-link-spike.example.cfg` to each private SD application directory as `online.cfg`. Change `name` and replace `TEST-2345` with the same unpredictable room code on both clients.
3. Confirm each client reaches `ONLINE`; the first should show `LINK <room> WAITING`.
4. Confirm both show `LINK <room> ACTIVE - BACKUP OK`. Do not continue if either screen reports a backup failure.
5. Confirm `link-backups/` contains a new timestamped 128 KiB save on both clients and never retains more than the newest three.
6. Enter the Cable Club, complete one battle, exit cleanly, restart both clients, and compare the two saves with their pre-link backups.
7. Repeat with one complete trade. Confirm the intended Pokémon moved exactly once, both games save, both restart, and no duplication/loss occurred.
8. Repeat while interrupting before handshake, during battle, during trade before confirmation, and immediately after confirmation. Restore from the automatic backup if either save is invalid.
9. Repeat on LAN and public WSS while recording the on-screen TX/RX counters, latency observations, disconnects, FPS, and audio stability.
10. Battle/trade invitations and rankings remain disabled until these tests pass between two emulator instances and between the physical Old 3DS XL and a second client.

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
12. Press `Y` and confirm the native party page shows each party nickname, level, and current/maximum HP. Damage or heal a party member and confirm HP updates without reopening the page.
13. Press `Y` again for Player Stats. Confirm Seen, Caught, Badges, and Frontier are shown locally while every upload switch is off. Tap Enable, cancel once and verify no upload, then enable by typing `YES`. Toggle each field independently and verify the paired browser profile/leaderboard follows. Confirm no Trainer ID, Pokémon, party, moves, inventory, save, or ROM field appears in network/profile data.
14. Tap Delete All Stats, cancel once, then type `DELETE`. Confirm the profile is immediately empty and stays absent after page refresh. Disable uploads before testing identity-wide browser deletion so the device cannot re-upload on its next minute sync.
15. Save through Emerald's normal menu, close using HOME, relaunch, and confirm the save loads and the local `stats.cfg` consent choices persist.

## CIA QR installation

1. Copy the private ROM and `online.cfg` from `generated/sd-card/3ds/emerald-online-3ds/` to the same path on the SD card first.
2. Open `https://emeraldonline3ds.com` on a phone or workstation.
3. On FBI, choose **Remote Install**, then **Scan QR Code**, and scan the page's QR code.
4. Confirm installation, launch the HOME Menu title, and repeat the gameplay/network checks above.
5. If using the public page, verify `https://emeraldonline3ds.com/health` reports `ok: true`, protocol `2`, and database `ready`. For the optional local page, verify both devices are on the same LAN and allow Node.js or TCP 8080 on the Windows private-network firewall profile.

## Two-client presence test

Run the same build on a second 3DS (or one 3DS plus Azahar) and enter the same map on both. Each lower screen should name the other trainer, coordinates, facing, and show `Nearby trainers: 1`; entering different maps should return the count to zero. Once the local runtime has observed each facing direction, nearby remote trainers should use the transparently decoded Emerald trainer sprite for that direction. A magenta silhouette is the safe fallback before a direction has been captured. Walk one tile at a time and confirm the remote sprite glides rather than teleports. Send chat from each system and confirm it appears only while both are on the same map.

For a single-console production check, keep the physical player online in the overworld and stream the cluster-local peer utility into the read-only presence container:

```bash
kubectl exec -i -n pokemonemeraldonline3ds deployment/emerald-online -c presence -- \
  env PEER_DURATION_MS=180000 node --input-type=module - < tools/live-peer.mjs
```

The temporary `Brendan` peer privately discovers the first positioned trainer, follows map changes and movement, walks around adjacent tiles, sends one greeting, waves, and disconnects after the requested duration. The utility does not expose the private client-discovery endpoint publicly and never creates a database identity, score, forum account, ROM, or save. Confirm the lower screen shows `Brendan` under Nearby and that its trainer sprite moves near the physical player.

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
