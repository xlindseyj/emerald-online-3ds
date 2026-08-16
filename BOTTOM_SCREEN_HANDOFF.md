# Bottom-screen expansion handoff

Release 0.8.0 implements the planned Bag and Map/Radar pages without changing the network protocol or uploading additional game data. Automated source tests, the full PostgreSQL-backed suite, a headless Azahar production-network smoke, and emulator visual checks pass. Physical Old 3DS XL verification with a real save remains the release acceptance step.

## What changed

- `Y` cycles Online, Party, Bag, Map/Radar, and Player Stats.
- Bag is explicitly local-only. It reads the five Emerald save pockets, decrypts quantities and money in memory, and resolves item names from the user's validated private ROM. ROM data, inventory, quantities, money, and item names are never sent to the server or included in public artifacts.
- Bag touch controls select Items, Key Items, Poké Balls, TM/HM, or Berries and move between five-entry pages.
- Map/Radar displays the current map and tile, facing direction, a 16-position local trail, and same-map remote trainers using gender-aware colors and relative distance.
- `page=bag` and `page=map` are valid initial-page choices in `online.cfg`.

## Verification completed

- Full Node and PostgreSQL lifecycle suite: 38 passed, 0 failed, 0 skipped against disposable PostgreSQL 16.
- Runtime source assertions cover the five-page cycle, pocket offsets and capacities, Emerald quantity decryption, private-ROM item-name lookup, Bag touch regions, local trail capture, and nearby radar markers.
- Official Azahar 2126.0 headless smoke passed server-issued identity persistence, stable reconnect identity, stationary keepalive, automatic reconnect, state republish, movement snapshots, chat, and all four emotes.
- Azahar visual inspection confirmed both new pages fit and render cleanly. Map/Radar displayed its grid, player marker, coordinates, facing, nearby count, and trail. Bag tabs and privacy label rendered; item rows could not be visually validated because the isolated emulator profile had no playable save.
- The headless harness now runs Azahar in an isolated D-Bus session and terminates the emulator process group, preventing a desktop wake-lock stall and orphaned emulator processes.
- The production image was built for Linux amd64 and arm64 and published as immutable digest `sha256:ff5f05a947397164dc4d4a64ebf9c542c1d91a753f1d3a0060da4ecf83f824c1`. The checked-in Kubernetes workload and maintenance manifests point to that digest.
- Production rollout completed on 2026-08-16. Public health reported protocol 2 and database ready; the already-connected physical player automatically returned as authenticated and positioned after the restart. Live downloads matched all three release checksums.
- The post-deploy 0.8.0 WSS lifecycle passed enrollment, pairing, consent, snapshot/profile visibility, pagination, disabled battle/trade boards, compatibility reporting, field opt-out, historical deletion, and synthetic identity deletion.

## Physical acceptance checklist

Use the hashes in `release/SHA256SUMS`, preserve the private ROM, save, avatar atlas, `identity.cfg`, and `stats.cfg`, and replace only the public 3DSX/config or reinstall the CIA.

1. Enter the overworld with a real Emerald save and press `Y` through all five pages. Confirm the sequence wraps back to Online.
2. On Bag, compare money, item names, and quantities against Emerald's own Bag. Test all five tabs and both page arrows, including an empty pocket and a pocket longer than five entries.
3. Use, buy, sell, or move an item in Emerald and confirm the Bag page updates without restarting.
4. On Map/Radar, walk in several directions and confirm map, tile, facing, and trail update. Change maps and confirm the old trail is cleared.
5. Connect a second client or the temporary follower utility in the same map. Confirm its marker, gender color, name, and distance update, then disappear after leaving the map.
6. Confirm Bag contents never appear in browser profiles, WebSocket payloads, server logs, or database records.
7. Record the console model, system version, 3DSX/CIA path, observed hashes, and any visual, touch, performance, or crash defect in `TESTING.md`.

Do not mark physical acceptance complete from emulator evidence alone. The private save/ROM memory layout, touch behavior, SD access, and Old 3DS performance remain hardware-authoritative.
