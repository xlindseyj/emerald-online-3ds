# Hardware smoke test

The current 0.8.3 actual-game runtime defaults to `wss://live.emeraldonline3ds.com/game`; `online.cfg` can change that without rebuilding. It contains the gpSP 3DS ARM dynarec core but no ROM data. Experimental Serial-Poke remains disabled unless `link_room` is explicitly configured. When connection fails, the bottom screen replaces Nearby/Chat with a readable diagnostic panel; report all four lines, not only `E71`. Press `Y` to cycle Online, Party, Bag, Map/Radar, and Player Stats.

Verify every public artifact against `release/SHA256SUMS`; it is the authoritative checksum manifest generated for this release. The ignored private avatar atlas is not a public artifact and must never be copied into `release/`.

## Release 0.8.3 battle-overlay hotfix (2026-08-16)

- Build and release audit: the ROM-free CIA, 3DSX, and code-only corresponding-source archive rebuilt successfully. SHA-256 values are `5dd5253ba52dd88968693096387af84a546aaf93ca15790879f324af6448cb47`, `732cd07521f205ee0e7da8f80f313afe454d2e32c21495bc6cea901959eac049`, and `68f9c63dca0f05b6db7900ddcfe87475842ecd7453d8c58213eaddff9d38f030` respectively.
- Regression: remote trainers now render only while Emerald's active main callback is the verified original-US-ROM `CB2_Overworld` callback and the battle flag is clear. The runtime rechecks that context when reading presence and again when drawing, so stale map coordinates fail closed during scene transitions.
- Azahar: with a production-WSS peer connected on Route 102, the peer was visible beside the player, disappeared throughout a real wild Poochyena battle, and returned immediately after fleeing. The battle screen contained no remote sprite, name, or emote; the lower screen reported that it was waiting for the overworld.
- Automated verification: all 54 tests passed against disposable PostgreSQL 16 with zero skips, and the release audit passed.
- Production: multi-architecture image `sha256:3f185c8c132cfe3481dd9ec13b2e286862a8b09a2eb654b678d0127a3c3fb1c8` rolled out with both init containers successful and zero application restarts. The publisher reported eight release topics, one known issue, and nine maintained community pages with v0.8.3 current; all four public services are operational and live artifact hashes match the manifest.
- Physical acceptance: v0.8.2 exposed the overlay defect during a real wild battle. The v0.8.3 CIA and 3DSX were then staged with matching re-downloaded hashes while the existing WSS/link configuration and newest save remained byte-for-byte unchanged. With v0.8.3 online on the physical 3DS and a temporary same-map production peer connected, the user entered a battle and confirmed the remote-trainer hiding fix worked. The temporary peer was disconnected afterward. Cable Club battle/trade acceptance remains separate and open.

## Release 0.8.2 Gate 4 preflight (2026-08-16)

- Build and release audit: the ROM-free CIA, 3DSX, and code-only corresponding-source archive rebuilt successfully. SHA-256 values are `28b27c96227fae1c596e85b711787d56597b6a7b2063c74cb0378109e3b85ac0`, `e58b33b02f5b9119596c19ada1870276c1fa2dd80594c68933d43f6a5a132abc`, and `1036e7008ecf1f5a5b128e98d1b08fac1e52cf04394c0e662d4588ae7b568ebb` respectively.
- Save validation: the physical save copy has two complete checksum-valid slots; its active slot records 49 minutes, one party member, and Route 102. Only those non-identifying progress facts enter the ignored bundle manifest.
- Azahar: official 2126.0 loaded the exact v0.8.2 3DSX and progressed save through gpSP interpreter mode, authenticated over production WSS, entered the isolated Gate 4 room, and remained alive beyond the former invalid-opcode/socket-assertion point. The observed emulator rate was about 29 FPS; this is not a physical performance result.
- Network regression: the local-TCP smoke passed identity persistence, stationary keepalive, forced reconnect, state republish, movement, chat, and four emotes. The production-WSS smoke enrolled and deleted its synthetic identity.
- Automated suite: 53 passed, 0 failed, 0 skipped after migrations 001-006 against disposable PostgreSQL 16.
- Physical staging: re-downloading the console's current 3DSX and staged CIA produced the v0.8.2 hashes above. The v0.8.1 binaries and pre-link configuration were backed up independently, private files were preserved, and the remote save still matched its pre-test SHA-256. The CIA still needs the user to select it in FBI; copying it to `/cias/` alone does not update the HOME Menu title.
- Production: multi-architecture image `sha256:f6970d835868a01b92126a04cba42a8a582cd758c0410fb0c0041d2ccf72fa5b` rolled out with both init containers successful and zero application restarts. The live homepage reports v0.8.2, the publisher reports seven release topics plus nine maintained community pages, all four public status checks are operational, and the live CIA/3DSX/source hashes match `release/SHA256SUMS`.

## Release 0.8.0 verification (2026-08-16)

- Bottom pages: source tests pass for Online, Party, Bag, Map/Radar, and Player Stats; Bag/Map configuration aliases and touch regions are covered.
- Bag privacy and decoding: source tests cover each pocket's Emerald save offset/capacity, quantity decryption, local money decryption, and private-ROM item-name lookup. No inventory field was added to the protocol, server, database, or browser profile.
- PostgreSQL suite: 42 passed, 0 failed, 0 skipped against disposable PostgreSQL 16 after release automation was added, including all identity, community, consent, leaderboard, compatibility, official-publication, and deletion lifecycles. The disposable containers were removed afterward.
- Headless emulator: official Azahar 2126.0 passed the 0.8.0 network smoke with both the default page and `page=map`. It persisted a server-issued identity, retained it across reconnect, stayed online while stationary, automatically reconnected, republished state, received movement/chat/emotes, and exited without orphaned processes. The harness isolates D-Bus so the emulator UI thread cannot stall while requesting a desktop wake lock.
- Visual emulator checks: Bag tabs and the `BAG - LOCAL ONLY` label render cleanly; Map/Radar renders its grid, player marker, coordinates, facing, nearby count, and trail. The isolated emulator profile had no playable save, so real Bag item rows and decrypted values remain unverified visually.
- Hardware status: physical acceptance remains pending. Follow `BOTTOM_SCREEN_HANDOFF.md`; emulator results do not validate the Old 3DS touch, private save/ROM memory, SD, or performance paths.
- Production: the amd64/arm64 image at immutable digest `sha256:ff5f05a947397164dc4d4a64ebf9c542c1d91a753f1d3a0060da4ecf83f824c1` rolled out successfully. Public health reported protocol 2/database ready, release downloads matched `release/SHA256SUMS`, the connected physical client automatically reauthenticated and republished its positioned state, and the complete synthetic 0.8.0 WSS lifecycle passed before deleting its test identity.

## Official release publishing

1. Run `npm run release:validate`; confirm the latest catalog version equals `package.json`, the homepage renders that version, every current artifact matches `release/SHA256SUMS`, and the known-issue catalog validates.
2. Against disposable PostgreSQL, run migrations and `npm run release:publish` twice. Confirm the second run keeps the same topic IDs, the number of publication rows equals the number of catalog versions, and exactly the newest version is pinned.
3. Fetch `/api/community/topics?category=releases` anonymously. Confirm each entry is public, has `official_release: true`, exposes no player identity, and the current release is first and pinned.
4. Open the current topic. Confirm headings, lists, internal download links, project/setup images, checksums, limitations, and upgrade notes render correctly. Remote images, scripts, raw HTML, and unsafe URLs must remain inert.
5. Pair a browser and reply to the official release. Confirm discussion remains available while ordinary paired users cannot create or impersonate a Releases topic.
6. Fetch the confirmed FPS topic anonymously. Confirm `official_known_issue: true`, `defect_status: confirmed`, no player identity, the device/scene variability description, and the Online off/on workaround after the scene.
7. List and extract the public source archive. Confirm it contains `LICENSE.txt`, `VERSION.txt`, the runtime frontend, and gpSP source, while containing no `.md`, assets, server/web/deploy directories, private IPs, infrastructure identifiers, or secret-like files.
8. Fetch every entry in `release/community-pages.json` by stable publication key. Confirm the public welcome, install, emulator, and status guides render anonymously; paired-only board guides appear after pairing; official attribution contains no player identity; and a second publisher run preserves every topic ID.
9. See `RELEASE_PUBLISHING.md` for the catalog, media, source-package, deployment, and failure-handling contract.

Production verification on 2026-08-16 passed with multi-architecture image `sha256:823f92c4753c7d43b74f13d70816a9663e71edbc24214862558f9edc3b5945b2`. Migration 004 and both init containers completed with exit code 0. Anonymous API verification found five official versions (`0.3.2`, `0.5.0`, `0.6.1`, `0.7.1`, `0.8.0`), exactly one pinned topic, two rendered same-origin images on 0.8.0, and no player attribution. A live second publication kept the same 0.8.0 topic ID.

The follow-up privacy/known-issue rollout uses multi-architecture image `sha256:0178c8daa9ef85164d8bdfc750b920c714818dd43280afd8d036ea4182b21520`. Migrations 004 and 005 and the release publisher exited 0, both application containers had zero restarts, and production remained database-ready on protocol 2. The homepage displayed `v0.8.0`; its source link served code-only archive SHA-256 `bc0e645335246e706962dc6f86d1715b584d8464280c8205a53155789c8b3c67`, matching the live manifest and containing no Markdown or excluded first-party directories. Anonymous API verification found the official confirmed FPS issue at topic `b3570148-29d7-44e8-b60c-944f9874bf17` with no player attribution and the complete Online-toggle workaround. At the same checkpoint, production observed one authenticated, positioned physical client in one room.

The Gate 4 handoff rebuild and rollout uses multi-architecture image `sha256:d46a3f064b31a493e4a9e4dabb6d34abd287cc1ba9ba36c7cc12ae2db98193ee`. Both init containers exited 0, both application containers had zero restarts, and the connected physical client automatically returned authenticated and positioned. The public CIA and manifest matched SHA-256 `500169bf7579fe118b39bd79d307c1b95a21ea5b2fcffb201ddf21bad7c94a45`; the existing pinned 0.8.0 release topic retained ID `cfe84b4d-4826-46d3-a5be-d277b3f79e64` and was updated in place with the new artifact checksum.

## Physical device v0.8.1 staging (2026-08-16)

The v0.8.1 3DSX and CIA were transferred through the console's private ftpd service. Re-downloading each file from the device produced the release-manifest hashes `33cf8ccda02205ab352b08811ae059cf86b81794c0101481788dc8d49d083b80` and `012da4236b2018d5e64faefcfedfe786fe207d0b925cf714cf755c534e385c37`. The existing `online.cfg` already selected `live.emeraldonline3ds.com:443`, WSS, and `/game`, so it was preserved along with `identity.cfg`, `stats.cfg`, the ROM/save area, and avatar data. The previous public 3DSX remains beside the application as a recoverable `.pre-v0.8.1.bak`. The CIA is staged under `/cias/`; physical HOME Menu execution still requires selecting it in FBI, and physical runtime acceptance is not claimed until the user launches and completes the checklist.

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
- Headless emulator: Gate 3 passed with official Azahar 2126.0 on Linux. See the current 0.8.0 verification section above for the latest release result. Physical hardware remains authoritative for the mbedTLS, SD, touch, and performance paths.

The release directory contains the CIA, 3DSX, and code-only 3DS-runtime/corresponding-gpSP source archive; verify their current sizes and hashes from the files and `release/SHA256SUMS`. Documentation, infrastructure, release media, branding assets, the private ROM, and the atlas are not part of that source download. The private 3DS package includes the ROM and atlas; the public release never does. Reinstall the CIA after every replacement; overwriting `/cias/emerald-online-3ds.cia` does not update an already installed HOME Menu title.

## Gate 4 experimental link smoke

Automated evidence: two isolated Azahar 2126.0 profiles passed four startup/hard-interruption cycles and retained exactly the newest three save backups per profile. A production-WSS test delivered 53 bounded synthetic packets, recovered from a hard guest disconnect, and measured 164-186 ms round trip (171 ms average) with 4.5 ms mean absolute jitter. Because the available emulator state remained at the title screen and emitted zero Cable Club packets, this is transport evidence only; the battle, trade, save-integrity, real packet-loss, and physical-performance steps below remain required.

The 0.8.0 rerun passed all 45 tests with zero skips against disposable PostgreSQL 16, the normal Azahar online smoke, and four two-instance link cycles. A fresh production-WSS run delivered 53 synthetic packets, recovered the guest, measured 173.6-200.9 ms round trip (182.9 ms average) with 5.6 ms mean absolute jitter, and deleted both synthetic identities. `npm run prepare:link-test` now builds a shared-room physical SD handoff and isolated Azahar profile under ignored `generated/`; its tests verify strict room/save validation and that no ROM, save, identity, preference, or avatar file enters the physical bundle. See `GATE_4_PHYSICAL_TEST.md`.

## Observability and load testing

1. Fetch the presence status server's `/metrics` directly. Confirm Prometheus text contains connection capacity, current aggregate player/room counts, protocol counters, database readiness, and process memory, but no player name, fingerprint, identity, IP, map, chat, ROM/save, party, or inventory value.
2. Confirm the production pod annotations advertise port 3211 and `/metrics`, while NetworkPolicy permits that port only from the Prometheus pod in `lindseywebsolutions` and node health probes.
3. Run `npm run load:test` against loopback. Remote targets must fail without `ALLOW_REMOTE_LOAD_TEST=YES`; client count, duration, and rate must reject values above 48, 60 seconds, and 10 Hz.
4. The phase baseline is 32 concurrent clients for five seconds at 5 Hz: 768 accepted states, 24,080 received snapshots, 32/32 pongs, zero protocol errors/rejections/authentication failures, and 7.3 ms p95 hello latency.
5. Query Prometheus for `emerald_online_database_ready`, `emerald_online_authenticated_players`, and `emerald_online_state_updates_total`, then open Grafana dashboard UID `emerald-online-3ds` and confirm all 12 panels resolve.

The v0.8.1 local release suite passed all 50 tests with zero skips against disposable PostgreSQL 17, including migration 006, official community-page idempotency, stable guide URLs, live public-status rendering, release-media serving, metrics privacy, and bounded-load behavior.

Production v0.8.1 uses multi-architecture image index `sha256:64134b4dc71f754abfd7ef9567fe9124b577d695834dd45304b07a0fed003637` with verified amd64 and arm64 manifests. Migration 006 and both publisher/application init paths completed with exit code 0; both application containers became Ready with zero restarts. Public verification returned four Operational services with their public URLs, six releases with exactly one pinned release, one confirmed known issue, and nine stable official community pages. The homepage rendered visibly separated Download CIA, Open community, and View live status buttons plus both project-owned screenshots. Public CIA, 3DSX, source, screenshot, and manifest hashes matched the repository. Prometheus reported the metrics target Up with database readiness `1`, Grafana dashboard UID `emerald-online-3ds` returned all 12 panels, and a fresh public WSS protocol-v1 client received `welcome`.

## Gate 4 Cable Club acceptance

1. Preserve an independent copy of both saves. Use release 0.8.3 on both clients and verify both artifacts against the current `release/SHA256SUMS`.
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
13. Press `Y` for Bag. Compare money, item names, and quantities against Emerald's own Bag; use all five pocket tabs and both page arrows. Confirm the page is labeled local-only and that no inventory data appears in browser profiles or network payloads.
14. Press `Y` for Map/Radar. Walk and change facing to build a trail, then change maps and confirm the old trail clears. With a same-map peer, verify the remote marker, name, gender color, and distance update.
15. Press `Y` again for Player Stats. Confirm Seen, Caught, Badges, and Frontier are shown locally while every upload switch is off. Tap Enable, cancel once and verify no upload, then enable by typing `YES`. Toggle each field independently and verify the paired browser profile/leaderboard follows. Confirm no Trainer ID, Pokémon, party, moves, inventory, save, or ROM field appears in network/profile data.
16. Tap Delete All Stats, cancel once, then type `DELETE`. Confirm the profile is immediately empty and stays absent after page refresh. Disable uploads before testing identity-wide browser deletion so the device cannot re-upload on its next minute sync.
17. Save through Emerald's normal menu, close using HOME, relaunch, and confirm the save loads and the local `stats.cfg` consent choices persist.

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
