# Bottom-screen expansion handoff

Release 0.8.0 implements the planned Bag and Map/Radar pages without changing the network protocol or uploading additional game data. Automated source tests, the full PostgreSQL-backed suite, a headless Azahar production-network smoke, and emulator visual checks pass. Physical Old 3DS XL verification with a real save remains the release acceptance step.

## Post-0.8.8 navigation improvements

- `L` moves to the previous bottom-screen page; `R` moves to the next page. Both wrap around the 13-page ring.
- `Y` continues to cycle forward one page at a time, unchanged.
- The header hint shows `< L   Y   R >` and the active page indicator dot is highlighted with a larger white ring so the current page is easier to spot.
- The page count is now a single `PAGE_COUNT` constant in `gpsp-runtime/source/ui/pages.h`, making future page additions less error-prone.

## Post-0.8.8 top-screen overlay improvements

- A small HUD in the top-left corner shows FPS, connection status, and nearby trainer count.
- Remote trainers render with their real `avatars.t3x` sprite, animated walk cycle, and facing direction (already present); their name and title labels now fade out when the trainer is far away.
- A faint trail line is drawn behind moving remote trainers to show recent path.
- Sprites, names, titles, and emote bubbles are clamped to the top-screen edges so overlays never drift partially off-screen.
- Overlays remain suppressed outside the verified overworld and on native multiplayer maps.

## Post-0.8.8 bottom-screen performance, states, settings, accessibility, and toasts

- Text rendering is batched through `drawTextStatic()` and the static-text cache was enlarged to 256 entries / 8192 bytes. Pages now cache headers and stable labels once per frame instead of reparsing fonts for every draw call.
- All pages share the same `drawWaitingMessage()`, `drawConnectOnlineMessage()`, `drawEmptyMessage()`, and `drawMessageCentered()` helpers, so "Waiting...", "Connect to view", and "Empty" states use identical placement, color, and wrapping.
- A new Settings page (`PAGE_SETTINGS`) is reached with `L`/`R`/`Y` alongside the other pages. It lets the player toggle:
  - Top-screen HUD visibility (`hudVisible`)
  - FPS display (`fpsVisible`)
  - Remote trainer trail length (`trailLength`)
  - Name/title label fade distance (`labelFadeDistance`)
  - Accessibility mode (`accessibilityMode`) — enlarges text globally and boosts contrast on shared UI surfaces
- Settings are persisted to `/3ds/data/emerald-online-3ds/display.cfg` and loaded at startup.
- The page indicator ring and input dispatch include the new Settings page.
- Top-screen toast banners appear for important online events: new chat messages, friends coming online, quests accepted/completed, and guild roster updates. Toasts auto-dismiss after three seconds and are drawn above overlays so they remain readable.

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

1. Enter the overworld with a real Emerald save and press `Y` through all pages. Confirm the sequence wraps back to Online. Then press `L` to move backward and `R` to move forward, confirming both wrap at the ends of the 13-page ring. Note that `L`/`R` are also GBA input buttons, so they may trigger the registered item or other in-game actions while navigating.
2. Open the Settings page, toggle each option, and press `A` to save. Reboot the client and confirm the Settings page restores the saved values. Verify the top-screen HUD appears or disappears according to the **Top-screen HUD** toggle and the **FPS display** toggle, and that remote trainer trails and name labels respond to the **Trail length** and **Label fade distance** toggles.
3. Enable **Accessibility mode** and confirm text is larger on every bottom-screen page and the top-screen HUD panel becomes more opaque. Disable it and confirm the UI returns to normal scale. Pay special attention to the Bag and Online Users pages to make sure enlarged text does not overflow narrow columns.
4. With a second client, send a chat message, come online as a friend, complete a quest, and trigger a guild roster change. Confirm a toast banner appears at the top center of the top screen for each event and auto-dismisses after a few seconds.
5. Visit empty or offline-dependent pages (Party, Bag before loading a save, Player Stats, Guild, etc.) and confirm the "Waiting...", "Connect to view", and "Empty" messages use the same style, color, and vertical placement across every page.
6. On Bag, compare money, item names, and quantities against Emerald's own Bag. Test all five tabs and both page arrows, including an empty pocket and a pocket longer than five entries.
7. Use, buy, sell, or move an item in Emerald and confirm the Bag page updates without restarting.
8. On Map/Radar, walk in several directions and confirm map, tile, facing, and trail update. Change maps and confirm the old trail is cleared.
9. Connect a second client or the temporary follower utility in the same map. Confirm its marker, gender color, name, and distance update, then disappear after leaving the map. Walk the second trainer around and confirm the faint movement trail appears and the name label fades at the edge of the visible window.
10. Move the second trainer to the edge of the visible window and confirm the sprite, name, and any emote bubble stay fully on the top screen.
11. Confirm Bag contents never appear in browser profiles, WebSocket payloads, server logs, or database records.
12. Record the console model, system version, 3DSX/CIA path, observed hashes, and any visual, touch, performance, or crash defect in `TESTING.md`.

Do not mark physical acceptance complete from emulator evidence alone. The private save/ROM memory layout, touch behavior, SD access, and Old 3DS performance remain hardware-authoritative.
