# Emerald Online 3DS Mobile

An iOS-first, single-game Capacitor launcher for the Emerald Online 3DS 3DSX
runtime. It embeds the pinned Azahar libretro core and accepts only the exact
supported Pokémon Emerald US revision-0 dump supplied by the user.

The app does not contain a ROM, save, Nintendo system file, game library, or
general-purpose emulator interface. The imported ROM stays in the iOS app
sandbox and is never uploaded.

## Local checks

```sh
npm ci
npm test
npm run build
npm run runtime:stage
npm run core:fetch
npm run cap:sync
```

The final four commands that touch Xcode require macOS, except the artifact
staging commands. Build and signing are automated by the root
`codemagic.yaml`. Only the separate ad-hoc acceptance build requires the target
device to be registered in the Apple developer team used by the
`Emerald Online ASC` Codemagic integration. The app uses its own bundle ID.

The `emerald-ios-compile-check` workflow compiles the device target without
Apple credentials and packages a privacy-audited IPA for SideStore, whose
install pipeline re-signs the app for the user's device. The
`emerald-ios-sideload` workflow remains the authoritative ad-hoc build for
registered-device acceptance testing.

Codemagic emits both the SideStore IPA and a corresponding source archive. The
archive includes this launcher, the embedded 3DS runtime source, the modified
gpSP source, and the complete GPLv2 text. Azahar's matching 2126.0 source is
linked in `THIRD_PARTY_NOTICES.md`.

The audited Codemagic artifact is named `emerald-online-3ds-ios.ipa`. Before a
website image build, stage that file at `release/emerald-online-3ds-ios.ipa` and
add its SHA-256 line to `release/SHA256SUMS`. The website then exposes it at
`/download/ios` and lists it, with its exact byte size, at
`/source.json`. Add the source directly in SideStore with:

```text
sidestore://source?url=https%3A%2F%2Femeraldonline3ds.com%2Fsource.json
```

## Runtime layout

Private files live under the application support directory:

```text
Azahar/
  sdmc/3ds/emerald-online-3ds/
    emerald.gba
    emerald.sav
    emerald-online-3ds.3dsx
    online.cfg
    identity.cfg
    stats.cfg
    display.cfg
    link-backups/
```

The launcher always writes `dynarec=disabled` for the nested gpSP runtime. That
setting is independent of Azahar's outer iPhone-side JIT and must remain off
because the emulated 3DS does not provide the physical console's Luma cache
invalidation bootstrap.

The default **Compatible Interpreter** mode works without executable-memory
permissions. On iOS 17.4 through iOS 18, users can instead select **StikDebug
JIT**. The app verifies `get-task-allow`, opens the official
`stikdebug://enable-jit` request for its current PID, confirms `CS_DEBUGGED`
after returning, and only then enables Azahar CPU and shader JIT. The pairing
file stays in StikDebug and is never imported, stored, or logged by this app.

iOS 26 remains interpreter-only in 0.9.3. A debugger attachment alone is not
enough there: Azahar's executable-memory allocator must first implement the
TXM/SPTM universal region-preparation protocol. The launcher refuses to claim
JIT readiness on iOS 26 rather than risk executing unprepared pages.

The launcher Settings page controls audio, equal-width stacked screens, and an
optional experimental auto-resume point. During play, **Menu** can resume,
toggle audio or display sizing, create/delete a resume point, reset to the game
title, or exit to the launcher. Rotation always keeps the screens stacked.

Auto-resume state is app-private, excluded from `.eobackup` exports, and never
replaces Emerald's normal battery save. It is disabled by default because core
states are larger and less portable than in-game saves.

## Physical acceptance

Simulator UI checks do not prove emulation. A release is complete only after a
registered physical iPhone installs the IPA, rejects an invalid ROM, imports a
legal supported dump, reaches gameplay, exercises portrait and landscape touch
controls, connects to the production WSS service, resumes safely, and runs for
at least 15 minutes with diagnostics captured.
