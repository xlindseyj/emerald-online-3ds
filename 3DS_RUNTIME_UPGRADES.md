# 3DS Runtime Upgrade Roadmap

This file tracks the planned improvements to `gpsp-runtime` based on a survey of the broader 3DS homebrew ecosystem. Each item includes the goal, the ecosystem pattern it follows, and the expected impact.

## 1. Split the monolithic `main.cpp` into page modules

**Goal:** Move each bottom-screen page and major subsystem out of `gpsp-runtime/source/main.cpp` into focused translation units.

**Ecosystem pattern:** Modern 3DS homebrew splits rendering, input, networking, and game integration into separate files rather than one large `main.cpp`.

**Expected impact:**
- Faster incremental builds
- Easier to add new pages without touching the emulator core
- Clear ownership for teleport, chat, update, stats, map, bag, party, and online users

**Files created:**
- `gpsp-runtime/source/ui/pages.h`
- `gpsp-runtime/source/ui/pages.cpp`
- `gpsp-runtime/source/network/http_client.h`
- `gpsp-runtime/source/network/http_client.cpp`

---

## 2. Centralize TLS/HTTP client

**Goal:** Replace the scattered raw `mbedtls` + `send/recv` code with one reusable `HttpClient`/`WssClient` that update, online presence, and telemetry can all use.

**Ecosystem pattern:** Most homebrew either uses the `libcurl` 3DS port or wraps `mbedtls` in a reusable client. Hand-rolled TLS in every subsystem is uncommon.

**Expected impact:**
- Smaller, reviewable networking code
- Consistent certificate handling, timeouts, redirects, and resume support
- Easier to add HTTPS endpoints later (leaderboards, forums, asset downloads)

**Approach:** Keep `mbedtls` under the hood but encapsulate connect, handshake, read, write, and WebSocket frame parsing behind a small class or C API.

---

## 3. Add system software keyboard (`swkbd`) for text input

**Goal:** Use the 3DS system keyboard for chat messages, custom teleport coordinates, and any other free-form text entry.

**Ecosystem pattern:** The standard 3DS text-entry experience is `swkbd`. Drawing a custom keyboard is rare unless the app needs in-game integration.

**Expected impact:**
- Better UX (Qwerty, predictive input, system styling)
- Removes the need to maintain a custom on-screen keyboard
- Frees bottom-screen real estate for game content

**Pages affected:** chat reply input, moderator custom teleport coordinates.

---

## 4. Improve input handling with `hidKeysRepeat()` and touch debounce

**Goal:** Replace manual held-key timers with `hidKeysRepeat()` and add tap/scroll gesture handling for lists.

**Ecosystem pattern:** libctru provides `hidKeysRepeat()` exactly for this.

**Expected impact:** Better Old 3DS responsiveness, fewer accidental selections in lists.

---

## 5. Add a CMake build option

**Goal:** Provide a CMake-based build as an alternative to the hand-written Makefile.

**Ecosystem pattern:** devkitPro ships 3DS CMake modules; many projects use CMake for CI and IDE integration.

**Expected impact:** Easier CI, better editor support, no change to the existing Makefile build.

---

## 6. Publish a Universal-Updater manifest

**Goal:** Ship an `info.json` or UniStore manifest so users can update through Universal-Updater without launching the game.

**Ecosystem pattern:** Universal-Updater is the de-facto homebrew app store on 3DS.

**Expected impact:** Convenience updates, reduced reliance on the in-app updater alone.

---

## 7. Strengthen save backup and integrity

**Goal:** Add sector-checksum validation before/after backup and consider retaining more than three backups.

**Ecosystem pattern:** Homebrew that touches saves usually validates sector data and keeps multiple rolling backups.

**Expected impact:** Lower chance of a corrupted save being promoted to the active slot.

---

## 8. Add APT sleep/resume hooks

**Goal:** Pause audio, network, and emulation cleanly when the lid closes or the system sleeps.

**Ecosystem pattern:** Proper `APT_Hook` handling is required for stable sleep behavior in homebrew.

**Expected impact:** Better battery life, fewer crashes/wifi stalls after waking.

---

## 9. Optimize UI text rendering

**Goal:** Pre-bake UI strings into a sprite atlas at startup instead of parsing text every frame.

**Ecosystem pattern:** Performance-focused homebrew avoids per-frame `C2D_TextParse` for static labels.

**Expected impact:** Fewer CPU spikes on Old 3DS when rendering static menus.

---

## 10. Improve audio threading

**Goal:** Run audio mixing/upload on a light thread so network stalls do not cause audio crackle.

**Ecosystem pattern:** Audio is usually decoupled from the main loop in networked emulators.

**Expected impact:** Smoother audio during lag spikes.

---

## 11. Add localization support

**Goal:** Move UI strings out of hardcoded literals and into a lookup table.

**Ecosystem pattern:** Any homebrew with a broad user base supports multiple languages.

**Expected impact:** Future translation work becomes practical.

---

## 12. Add runtime observability

**Goal:** Replace/augment `gpsp-debug.log` with a RAM ring buffer and/or server-uploaded telemetry.

**Ecosystem pattern:** Some homebrew uses `ERRF` for crash reports and ring buffers for runtime logs.

**Expected impact:** Easier remote debugging of physical-device issues.

---

## Phase Plan

### Phase 1 (done)
1. Split `main.cpp` into page modules
2. Centralize TLS/HTTP client
3. Add `swkbd` for text input

### Phase 2 (done)
4. Improve input handling with `hidKeysRepeat()` and touch debounce
5. Add a CMake build option
6. Publish a Universal-Updater manifest
7. Strengthen save backup and integrity

### Phase 3
8. Add APT sleep/resume hooks
9. Optimize UI text rendering
10. Improve audio threading

### Phase 4
11. Add localization support
12. Add runtime observability
