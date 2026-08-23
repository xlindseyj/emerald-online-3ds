# iOS Sideload Handoff — 2026-08-23

This document records the complete iOS sideloading vertical slice added on
2026-08-23: the mobile application, native emulator bridge, ROM and local-data
boundaries, Codemagic workflows, SideStore source, website delivery, release
verification, and production rollout.

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
- The published preview is version `0.9.0`, build `5`, bundle identifier
  `com.emeraldonline3ds.mobile`, and requires iOS 15 or newer.
- The live IPA is a real 64-bit ARM iPhone application. Its SHA-256 is
  `8b55a8117dfdc7b22c431f08db714fddb4a84ebeaf854b9f6a51b731ad3da57a`
  and its size is `13,652,874` bytes.
- Codemagic build `6a8b683c0869a152bc6f2d9c` produced the published
  SideStore-re-signable IPA.
- Automated compilation, package, schema, privacy, website, and live-service
  checks pass. Physical installation and launch now pass; gameplay remains an
  explicit acceptance gate because the first device run exposed a black-screen
  runtime issue after ROM discovery was corrected.

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
pointer, timing, and lifecycle callbacks. It uses software rendering and
disables CPU and shader JIT. The no-JIT policy avoids executable-memory and
sideload entitlement assumptions, but performance depends on the iPhone model
and must be measured on hardware.

For `citra_use_libretro_save_path=LibRetro Default`, Azahar appends
`Azahar/sdmc` to the save directory supplied by the frontend. The frontend must
therefore pass `EmeraldOnline3DS/` as the save root, not
`EmeraldOnline3DS/Azahar/`. Values such as `disabled` are not valid for this
string option and make the core silently retain its unrelated platform default.

The native controller converts Azahar's XRGB8888 video frames into iOS images,
feeds stereo PCM to `AVAudioEngine`, forwards touch coordinates, and maps both
on-screen controls and `GameController` inputs. Rotating to landscape changes
the Azahar layout to side-by-side; portrait uses its default stacked layout.
Leaving the foreground pauses the core and audio, returning resumes them, and
closing the emulator flushes a clean-session marker.

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
7. packages `Payload/App.app` as `emerald-online-3ds-ios.ipa`;
8. audits the IPA and writes its SHA-256 manifest; and
9. packages corresponding GPL source.

The resulting unsigned IPA is expected: SideStore re-signs it for the user's
device during installation.

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
npm run core:fetch --prefix mobile
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

## Verification completed on 2026-08-23

- Mobile tests: 8 passed.
- Repository suite: 148 passed and 5 environment-dependent tests skipped.
- Website route and SideStore-source tests passed.
- The live `/source.json` passed the official SideStore JSON schema.
- The legacy source returned `308` with `Location: /source.json`.
- The homepage contained only the canonical SideStore deep link.
- The live IPA matched the Codemagic SHA-256 and reported size.
- IPA inspection found a real ARM64 Mach-O app, the expected bundle/version,
  the bundled 3DSX, the pinned Azahar core, and licensing notices.
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
  visible in the tester's log. This is the active 0.9.1 retest target.

## Remaining physical acceptance

The IPA is structurally real and is the exact website download, but automated
checks do not establish iPhone usability. Before calling the iOS preview fully
accepted, complete all of the following on a physical iPhone:

1. Add `/source.json` to SideStore and install the re-signed IPA. This passed
   for 0.9.0 and must be repeated after every replacement IPA.
2. Confirm the launch screen, icon, bundle version, and first-run state. Launch
   passed for 0.9.0; repeat it on 0.9.1.
3. Confirm an unrelated/invalid ROM is rejected without being retained.
4. Import the legally obtained supported dump and reach Emerald gameplay. This
   remains blocked by the current post-ROM black-screen result.
5. Verify audio, on-screen controls, touch, and an external controller.
6. Rotate between portrait and landscape during both launcher and gameplay.
7. Connect through production WSS and verify the online lower screen.
8. Background and resume the app, then close and relaunch with save integrity.
9. Create and restore an `.eobackup`, inspect redacted diagnostics, and test
   scoped local deletion only after preserving the test save.
10. Run for at least 15 minutes while recording FPS, thermal state, audio
    behavior, crashes, and device/iOS model.

Do not describe physical installation, performance, gameplay, online behavior,
or save safety as passed until this checklist has been completed on the device.

## File map

- `mobile/src/ui/` — launcher interface and responsive styling.
- `mobile/src/lib/` — TypeScript domain rules and Capacitor contract.
- `mobile/ios/App/App/EmeraldRuntimePlugin.swift` — narrow web/native API.
- `mobile/ios/App/App/EmeraldStorage.swift` — ROM, configuration, recovery,
  diagnostics, and deletion boundaries.
- `mobile/ios/App/App/EmeraldEmulationViewController.swift` — video, audio,
  touch controls, game controllers, orientation, and lifecycle.
- `mobile/ios/App/App/Native/EO3DSCoreSession.mm` — Azahar/libretro host.
- `mobile/tools/` — core/runtime staging, IPA audit, and source packaging.
- `codemagic.yaml` — unsigned SideStore and ad-hoc acceptance workflows.
- `web/sidestore-source.mjs` — standards-conforming SideStore JSON.
- `web/install-server.mjs` — download, metadata, source, and redirect routes.
- `Dockerfile` and `.dockerignore` — production artifact staging rules.
