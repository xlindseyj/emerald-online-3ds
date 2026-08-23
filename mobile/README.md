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
`codemagic.yaml`. The target device must be registered in the Apple developer
team used by the `Emerald Online ASC` Codemagic integration. The app uses its
own bundle ID and provisioning profile.

The `emerald-ios-compile-check` workflow compiles the device target without
signing so a new native change can be verified before Apple credentials are
available. The `emerald-ios-sideload` workflow is the authoritative ad-hoc IPA
build.

Codemagic emits both the ad-hoc IPA and a corresponding source archive. The
archive includes this launcher, the embedded 3DS runtime source, the modified
gpSP source, and the complete GPLv2 text. Azahar's matching 2126.0 source is
linked in `THIRD_PARTY_NOTICES.md`.

The audited Codemagic artifact is named `emerald-online-3ds-ios.ipa`. Before a
website image build, stage that file at `release/emerald-online-3ds-ios.ipa` and
add its SHA-256 line to `release/SHA256SUMS`. The website then exposes it at
`/download/ios` and lists it, with its exact byte size, at
`/sidecommunity.json`. Add the source directly in SideStore with:

```text
sidestore://source?url=https%3A%2F%2Femeraldonline3ds.com%2Fsidecommunity.json
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

The launcher writes `dynarec=disabled`. The bundled no-JIT build is intended
for compatibility testing; performance depends on the iPhone model.

## Physical acceptance

Simulator UI checks do not prove emulation. A release is complete only after a
registered physical iPhone installs the IPA, rejects an invalid ROM, imports a
legal supported dump, reaches gameplay, exercises portrait and landscape touch
controls, connects to the production WSS service, resumes safely, and runs for
at least 15 minutes with diagnostics captured.
