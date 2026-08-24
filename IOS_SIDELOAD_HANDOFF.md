# iOS Sideload Handoff — 2026-08-24

This document records the complete iOS sideloading vertical slice added on
2026-08-23 and 2026-08-24: the mobile application, native emulator bridge, ROM
and local-data boundaries, Codemagic workflows, SideStore source, website
delivery, release verification, and production rollout.

## Current status

- The iOS project lives under `mobile/` and uses the same Capacitor pattern as
  the LWS Office iOS client: a React interface packaged in a native Xcode app,
  with privileged device work implemented by a narrow Capacitor plugin.
- The app is dedicated to Emerald Online 3DS. It has no game library, ROM
  browser, or route for launching another title.
- The website serves the SideStore source at
  `https://emeraldonline3ds.com/source.json` and the IPA at
  `https://emeraldonline3ds.com/download/ios`.
- `https://emeraldonline3ds.com/sidecommunity.json` returns a permanent `308`
  redirect to `/source.json` so previously added sources continue working.
- The published preview is version `0.9.4`, build `13`, bundle identifier
  `com.emeraldonline3ds.mobile`, and requires iOS 15 or newer.
- The live IPA is a real 64-bit ARM iPhone application. Its SHA-256 is
  `28b56719d3bdd8bd626df43a2f574cdb1dc4c15238a8480d184273543a595c8f`
  and its size is `12,853,897` bytes.
- Codemagic build `6a8ccb472ee7a9f5fa208b80` produced the published
  SideStore-re-signable IPA.
- Automated compilation, package, schema, privacy, website, and live-service
  checks pass. Physical installation, launch, ROM loading, gameplay, buttons,
  and basic rotation passed on 0.9.1. Version 0.9.4 requires repeat physical
  acceptance for audio, sustained JIT FPS, stable round-trip rotation,
  equal-width presentation, resume points, and interpreter fallback.

## What changed

| Area | Change |
| --- | --- |
| Mobile shell | Added a React, TypeScript, Vite, and Capacitor application with project branding and the desktop-style launch experience. |
| Native iOS layer | Added Swift storage, document import, settings, backup, diagnostics, lifecycle, audio, touch, controller, and emulator presentation code. |
| Emulator bridge | Added an Objective-C++ libretro host that dynamically loads the pinned Azahar 2126.0 ARM64 core and boots only the bundled Emerald Online 3DS 3DSX. |
| Runtime payload | Stages the current ROM-free `emerald-online-3ds.3dsx`, verifies it against a bundled manifest, and installs it into the private virtual SD directory. |
| Input and layout | Added portrait and landscape layouts, on-screen 3DS buttons, touch-screen forwarding, and extended game-controller bindings. |
| Local lifecycle | Added validated ROM import, local settings, safe backups/restores, redacted diagnostics, clean-exit detection, and scoped local-data deletion. |
| Codemagic | Added unsigned SideStore packaging and registered-device ad-hoc workflows, mobile tests, Xcode build logs, component staging, IPA auditing, checksums, and corresponding-source packaging. |
| Website | Added the iOS install tab, `/download/ios`, `/api/release` iOS metadata, and a standards-conforming SideStore source. |
| Distribution | Made `/source.json` canonical and retained `/sidecommunity.json` only as a compatibility redirect. |
| Deployment | Added the IPA and mobile release metadata to the production image and deployed the exact multi-architecture image digest. |
| Public hygiene | Kept the IPA, ROMs, saves, runtime configuration, credentials, internal hosts, and operational addresses out of the public Git repository. |

Several build-follow-up corrections were included: creating the Xcode log
directory before `tee`, deriving mobile version/source metadata from
`mobile/package.json`, packaging the unsigned device app into a conventional
`Payload/App.app` IPA, publishing the live file's exact checksum through
`/api/release`, copying mobile metadata into the website image, removing a
non-standard checksum field from the SideStore document, and renaming the
canonical source to `/source.json`.

The first physical iPhone run added two important follow-ups. Version 0.9.0
initially passed the wrong save-root policy to Azahar, so the core mounted a
platform-default SD directory instead of the launcher's sandboxed virtual SD.
After the tester manually placed files in the core's effective SD directory,
the missing-ROM error disappeared, but both emulated screens remained black
while the native iOS controls stayed visible and the runtime log showed no
obvious error. Version 0.9.1 corrects the libretro save-root contract, supplies
a persistent XRGB8888 software framebuffer, records whether the core emits no
frames or only black frames, and includes only allowlisted runtime stage names
in the privacy-safe diagnostics export.

## Runtime architecture

```text
React launcher UI
        |
        v
Capacitor EmeraldRuntime plugin
        |
        +--> EmeraldStorage
        |      ROM validation, private virtual SD, configuration,
        |      backup/restore, diagnostics, deletion
        |
        v
EmeraldEmulationViewController
        |
        v
EO3DSCoreSession (libretro host)
        |
        v
Pinned Azahar 2126.0 ARM64 core
        |
        v
Bundled Emerald Online 3DS 3DSX
        |
        v
Bundled gpSP frontend --> user's validated local Emerald dump
```

The nested runtime is deliberate. Azahar supplies the iPhone-side 3DS
environment, the project 3DSX supplies the same two-screen client used by the
desktop launcher and 3DS hardware, and gpSP inside that 3DSX runs the supported
GBA dump. The website and IPA contain neither the dump nor a save.

`EO3DSCoreSession` implements the libretro environment, video, audio, joypad,
pointer, timing, and lifecycle callbacks. It uses software rendering and now
enables Azahar JIT only when the native StikDebug coordinator has verified both
`get-task-allow` and the appropriate readiness state. Compatible Interpreter is
the default and remains available without JIT.

Version 0.9.4 builds the pinned Azahar 2126.0 core from source and applies the
project's reviewed Azahar, Dynarmic, and Oaknut patches. On iOS 26, opening the
StikDebug URL is only an attachment step: Play begins `universal.js`
preparation, every initial CPU RX cache executes the `brk #0xf00d` prepare
request, Oaknut creates a separate RW alias with `vm_remap`, and Azahar issues
the detach request before the first frame. JIT is marked ready only after that
sequence completes. Prepared CPU mappings are retained for title resets;
shader JIT stays off on iOS 26 because it allocates regions after detach.
iOS 17.4 through iOS 18 retain their debugger-enabled CPU and shader JIT path.
The app does not accept, persist, or log a pairing file.

For `citra_use_libretro_save_path=LibRetro Default`, Azahar appends
`Azahar/sdmc` to the save directory supplied by the frontend. The frontend must
therefore pass `EmeraldOnline3DS/` as the save root, not
`EmeraldOnline3DS/Azahar/`. Values such as `disabled` are not valid for this
string option and make the core silently retain its unrelated platform default.

The native controller converts Azahar's XRGB8888 video frames into iOS images,
feeds stereo PCM to `AVAudioEngine`, forwards touch coordinates, and maps both
on-screen controls and `GameController` inputs. Both orientations keep Azahar's
default stacked layout. An optional equal-width presentation enlarges the lower
screen while preserving its core-visible touch coordinates. Leaving the
foreground pauses the core and audio, returning resumes them, and closing the
emulator flushes a clean-session marker.

The 0.9.2 audio path uses a `.playback`/`.default` `AVAudioSession`, connects the
player node with Azahar's 32,768 Hz stereo format so `AVAudioEngine` can perform
the hardware-rate conversion, and moves PCM conversion onto a dedicated audio
queue. Frame-to-image construction likewise runs on a separate presentation
queue; the emulation queue retains user-interactive QoS and only performs the
bounded framebuffer copy before returning to Azahar.

The in-game Menu exposes Resume, audio and equal-width display toggles, a
manual resume point, restart to the game title, and Exit to Launcher. Optional
auto-resume serializes through Azahar's libretro state API on background/exit,
is disabled by default, is capped at 512 MiB, is removed when the ROM changes,
and is excluded from private backups. Emerald's normal battery save remains the
authoritative durable save.

## Single-game and ROM boundary

The document picker accepts one `.gba` file. Before retaining it, native code
requires all of the following:

- the supported file size;
- the Emerald title and `BPEE` game-code header;
- a valid GBA header checksum; and
- the exact allowlisted SHA-256 for the supported US revision-0 cartridge dump.

The imported file is copied into the app sandbox as `emerald.gba`; the original
picker URL is not retained. There is no API or user interface for choosing a
different core, 3DSX, system title, or ROM. The native `start` method refuses to
create a session unless the ROM, runtime manifest, and Azahar core are present.

## Private storage and recovery

The iOS Application Support directory is excluded from iCloud backup and uses
this virtual-SD layout:

```text
EmeraldOnline3DS/
  launcher-config.json
  runtime-state.json
  runtime-session.json
  diagnostics/launcher.jsonl
  Azahar/
    sdmc/3ds/emerald-online-3ds/
      emerald.gba
      emerald.sav
      emerald-online-3ds.3dsx
      online.cfg
      identity.cfg
      stats.cfg
      display.cfg
      avatars.t3x
      link-backups/
      update/
```

Before emulation, the app idempotently creates Azahar's `nand/`, `sysdata/`,
and `log/` directories, the full virtual-SD tree, default `online.cfg`, an
explicitly opted-out `stats.cfg`, and the default `display.cfg`, then stages the
verified 3DSX. It does not create placeholder user or credential data:
`emerald.gba` comes only from the validated document import, `emerald.sav` is
created by gpSP in its real format, and `identity.cfg` is created only from the
server's authenticated enrollment response.

At launch, the app verifies the bundled 3DSX against `Runtime/manifest.json`.
It atomically refreshes the working 3DSX when the bundled hash or runtime policy
changes. It writes validated launcher settings to `online.cfg`; production
defaults to `wss://live.emeraldonline3ds.com/game` and online mode can be
disabled without changing the endpoint.

`.eobackup` files are gzip-compressed, versioned JSON archives. They can contain
the save, identity, settings, display data, optional avatar atlas, and bounded
link backups. Every restored file is allowlisted, size-bounded, path-checked,
and SHA-256 verified before anything is written. The ROM, working 3DSX, update
downloads, and debug log are always excluded.

Exported diagnostics include only bounded launcher events and high-level
readiness state. They redact private addresses and email-like values and do not
include paths, ROM/save bytes, identities, tokens, or configuration values.
Delete Local Data refuses to operate outside the app's Application Support
subdirectory and is disabled while emulation is running.

## Launcher experience

The app opens with the project icon, banner, emerald visual treatment, and a
launch/status flow equivalent to the desktop client. The primary button changes
from **Select ROM** to **Play** after validation. The launcher exposes:

- runtime, core, and ROM readiness;
- online endpoint, trainer name, online toggle, and initial lower-screen page;
- local backup, restore, diagnostics, and deletion actions;
- links restricted to the official website, community, and status pages;
- manual update checks against the official `/api/release` endpoint; and
- runtime state, FPS, and device thermal status while playing.

The emulation view supports the D-pad, A/B/X/Y, L/R, Start, Select, lower-screen
touch, portrait/landscape rotation, and compatible external controllers. It
does not expose an emulator menu or content browser.

## Codemagic workflows

The repository-root `codemagic.yaml` defines two workflows.

### `emerald-ios-compile-check`

This is the public SideStore artifact path and does not require Apple signing
credentials. On a Codemagic Apple-silicon macOS worker it:

1. installs locked mobile dependencies;
2. runs the mobile tests and production web build;
3. stages and verifies the repository 3DSX;
4. downloads the pinned Azahar 2126.0 iOS libretro build and verifies its hash;
5. synchronizes Capacitor and installs CocoaPods;
6. compiles a Release `iphoneos` ARM64 app with code signing disabled;
7. ad-hoc signs the unsigned main executable with the SideStore request
   entitlement, verifies `get-task-allow=true`, and packages `Payload/App.app`
   as `emerald-online-3ds-ios.ipa`;
8. audits the IPA and writes its SHA-256 manifest; and
9. packages corresponding GPL source.

The resulting IPA carries only a local ad-hoc signature so SideStore can see
the requested debug entitlement. SideStore replaces that signature for the
user's device during installation. The installed app performs the
authoritative runtime entitlement check before it offers JIT.

### `emerald-ios-sideload`

This is the registered-device acceptance path. It is triggered by relevant
changes on `main`, uses the configured App Store Connect integration and signing
environment group, ensures the dedicated App ID exists, fetches an ad-hoc
profile, builds a signed IPA, audits it, and publishes the same checksum and
source artifacts. A device must be registered with the selected Apple developer
team before this build can prove direct ad-hoc installation.

Neither workflow stores a ROM. Both fail if tracked ROM/save/config files are
detected or the runtime/core audit fails.

## Local development and checks

From the repository root:

```sh
npm ci --prefix mobile
npm test --prefix mobile
npm run build --prefix mobile
npm run runtime:stage --prefix mobile
```

The remaining native steps require macOS with Xcode:

```sh
npm run core:build --prefix mobile
cd mobile
npx cap sync ios
cd ios/App
pod install --repo-update
xcodebuild -workspace App.xcworkspace -scheme App -sdk iphoneos \
  -destination 'generic/platform=iOS' build
```

Use the Codemagic workflows for reproducible release artifacts. Do not commit
downloaded cores, staged 3DSX files, IPA files, Xcode derived data, signing
identities, or provisioning profiles.

## SideStore and website delivery

Users add the source with:

```text
sidestore://source?url=https%3A%2F%2Femeraldonline3ds.com%2Fsource.json
```

The website constructs the JSON from `mobile/package.json` and the staged IPA:

- source ID: `com.emeraldonline3ds.sidestore`;
- app bundle ID: `com.emeraldonline3ds.mobile`;
- version, release date, and summary: mobile package metadata;
- file size: the exact staged IPA size;
- download URL: `/download/ios`; and
- minimum OS: iOS 15.0.

The source has an empty app list when no IPA is staged, so the site cannot
advertise a missing download. The output is tested against the official
SideStore source schema. `/api/release` independently computes and publishes
the live IPA SHA-256, while `/download/ios` streams those same bytes with a
download filename. The homepage's iOS tab uses the canonical deep link.

Release artifacts are intentionally ignored by Git. Before building a website
image, download the audited Codemagic IPA, verify it against the build's
`SHA256SUMS`, place it at `release/emerald-online-3ds-ios.ipa`, add/update its
entry in the repository checksum manifest, and run:

```sh
node mobile/tools/audit-ipa.mjs release/emerald-online-3ds-ios.ipa
npm test
npm run audit:release
```

The Dockerfile conditionally copies the staged IPA and always copies
`mobile/package.json`. Build and push both supported architectures, deploy the
immutable manifest digest, update every private deployment reference to that
digest, and then verify the public bytes. Public examples must use placeholders
such as `<your-registry>` and `<namespace>`; real infrastructure values belong
only in the private Gitea mirror.

### Repeatable release playbook

Treat this as a gated release pipeline rather than a single opaque action:

1. Trigger `emerald-ios-compile-check` for the intended public commit and wait
   for every Codemagic step to succeed.
2. Download the IPA and checksum artifact through the authenticated Codemagic
   API. Record the build ID, commit, app version, build number, byte size, and
   SHA-256 in this handoff.
3. Run the IPA privacy/structure audit, mobile tests, repository tests, and
   release audit before publishing any metadata.
4. Stage the ignored IPA at `release/emerald-online-3ds-ios.ipa`, update only
   its checksum line, and publish sanitized metadata to GitHub using the project
   author identity. Never copy private operator values into that commit.
5. Build and push the website for `linux/amd64` and `linux/arm64`, deploy its
   immutable manifest-list digest, and record real deployment values only in
   Gitea.
6. Verify the live health endpoint, `/source.json`, legacy redirect,
   `/api/release`, homepage deep link, and `/download/ios` hash and size.
7. Stop at the physical acceptance gate. A successful build, deployment, or
   simulator run cannot mark gameplay, controls, audio, rotation, online play,
   resume, or save integrity as passed on an iPhone.

Most of this should be implemented as deterministic scripts and CI checks. An
agent can orchestrate the commands, summarize evidence, maintain the two-mirror
privacy boundary, and diagnose failures, but it should require an explicit
release trigger and leave device acceptance to a human tester. Signing tokens,
profiles, and registry credentials must remain in their existing secret stores
and must never be written to generated reports or Git history.

## Verification completed on 2026-08-24

- Mobile tests: 12 passed.
- Private integration suite: 173 passed and 6 environment-dependent tests
  skipped, with the private ROM-backed package test enabled.
- Sanitized public-mirror suite: 148 passed and 5 environment-dependent tests
  skipped.
- Website route and SideStore-source tests passed.
- The live `/source.json` passed the official SideStore JSON schema.
- The legacy source returned `308` with `Location: /source.json`.
- The homepage contained only the canonical SideStore deep link.
- The live IPA matched the Codemagic SHA-256 and reported size.
- IPA inspection found a real ARM64 Mach-O app, the expected bundle/version,
  the bundled 3DSX, the source-built pinned Azahar core, all four universal-JIT
  exports, and licensing notices. The core SHA-256 is
  `f44e9456f38fefa2528a14974d3c0513e98b71b62dfa706858a45a1f3355452c`.
- The IPA privacy audit found no ROM, save, private configuration, credentials,
  or private address.
- The release/source-package audit passed independently.
- The production health endpoint reported protocol 2 and database ready, the
  WSS endpoint accepted a TLS connection, and the deployment completed on its
  immutable multi-architecture image digest.
- Current public branch contents were scanned for known identifying values and
  use the project commit identity `Emerald Online 3DS
  <noreply@emeraldonline3ds.com>`.
- Physical iPhone installation and native launcher startup passed. The first
  run reached the 3DSX's missing-ROM screen, proving the iOS view and Azahar
  content launch path were active. Manually correcting the core-visible SD path
  removed that error, after which the emulated top and bottom screens stayed
  black while native buttons remained responsive. No obvious runtime error was
  visible in the tester's log. Version 0.9.1 then passed ROM loading and reached
  gameplay on the physical phone. Buttons and rotation worked, but audio was
  silent, FPS was below the desired level, a portrait/landscape round trip could
  leave the screens side-by-side, and the player needed clearer in-game exit,
  sizing, and resume controls. Version 0.9.2 became the audio, stable-stacking,
  in-game-menu, equal-width, and optional-auto-resume baseline. Version 0.9.3
  added the first StikDebug path. Version 0.9.4 adds the source-built iOS 26
  universal CPU-JIT protocol for the next physical performance retest.

## Remaining physical acceptance

The IPA is structurally real and is the exact website download, but automated
checks do not establish iPhone usability. Before calling the iOS preview fully
accepted, complete all of the following on a physical iPhone:

1. Add `/source.json` to SideStore and install the re-signed IPA. This passed
   for 0.9.0 and must be repeated after every replacement IPA.
2. Confirm the launch screen, icon, bundle version, and first-run state. Launch
   and ROM loading passed through 0.9.1; repeat them on 0.9.4.
3. Confirm an unrelated/invalid ROM is rejected without being retained.
4. Import the legally obtained supported dump and reach Emerald gameplay. This
   passed on 0.9.1 and must be repeated on 0.9.4.
5. Verify audio, on-screen controls, touch, and an external controller. Buttons
   passed on 0.9.1; repeat audio and frame pacing on 0.9.4.
6. Rotate portrait → landscape → portrait → landscape and confirm the screens
   remain stacked. Also test native-width and equal-width modes. Basic rotation
   passed on 0.9.1, but the round trip exposed a stale side-by-side layout.
7. Connect through production WSS and verify the online lower screen.
8. Background and resume the app, then test optional auto-resume, Exit to
   Launcher, restart to the game title, and normal battery-save integrity.
9. Create and restore an `.eobackup`, inspect redacted diagnostics, and test
   scoped local deletion only after preserving the test save.
10. On iOS 17.4 or later, install the official sideloaded StikDebug and
    LocalDevVPN, import the device pairing file into StikDebug, mount the DDI,
    select **StikDebug JIT**, and confirm the launcher reports attachment. On
    iOS 26, tap Play and confirm it reports JIT active only after Azahar's
    prepare/detach handshake. Verify Compatible Interpreter still launches.
11. Terminate and reopen the app to confirm JIT must be reacquired for the new
    PID. Reboot once to exercise the DDI setup requirement. Do not import the
    pairing file into Emerald Online 3DS.
12. Run both modes for at least 15 minutes in the same scene while recording
    FPS, thermal state, audio behavior, crashes, and device/iOS model.

Do not describe physical installation, performance, gameplay, online behavior,
or save safety as passed until this checklist has been completed on the device.

## File map

- `mobile/src/ui/` — launcher interface and responsive styling.
- `mobile/src/lib/` — TypeScript domain rules and Capacitor contract.
- `mobile/ios/App/App/EmeraldRuntimePlugin.swift` — narrow web/native API.
- `mobile/ios/App/App/EmeraldJITCoordinator.swift` — StikDebug compatibility,
  entitlement, deep-link, PID, and debugger-readiness checks.
- `mobile/ios/App/App/EmeraldStorage.swift` — ROM, configuration, recovery,
  diagnostics, and deletion boundaries.
- `mobile/ios/App/App/EmeraldEmulationViewController.swift` — video, audio,
  touch controls, game controllers, orientation, and lifecycle.
- `mobile/ios/App/App/Native/EO3DSCoreSession.mm` — Azahar/libretro host.
- `mobile/tools/` — core/runtime staging, IPA audit, and source packaging.
- `codemagic.yaml` — SideStore request-signature and ad-hoc acceptance
  workflows.
- `web/sidestore-source.mjs` — standards-conforming SideStore JSON.
- `web/install-server.mjs` — download, metadata, source, and redirect routes.
- `Dockerfile` and `.dockerignore` — production artifact staging rules.
