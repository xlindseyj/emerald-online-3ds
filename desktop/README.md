# Emerald Online 3DS — Windows Desktop Launcher

This directory contains an Electron-based Windows desktop launcher. It provides a one-click installer, a branded animated title screen, and launches the project's 3DSX runtime inside the Azahar emulator so Windows users can play with the same dual-screen layout as on a Nintendo 3DS.

## Important legal note

The launcher **does not** contain or redistribute any Pokémon ROM, save data, or copyrighted game assets. On first launch it prompts the user to select their own legally obtained Pokémon Emerald (U) GBA dump. The ROM is validated and copied into a private application data directory; it is never uploaded or transmitted.

## Development

```powershell
# From the repository root, install desktop dependencies
cd desktop
npm install

# Run the launcher in development mode (no installer)
npm start

# Build the NSIS installer for Windows
npm run dist

# Build the AppImage for Linux
npm run dist:linux
```

### Smoke tests

```powershell
# Run on Linux
npm run smoke:linux

# Run on Windows
npm run smoke:windows
```

Smoke tests start the packaged desktop launcher, keep it running for a short time, then close it cleanly. The Linux test auto-discovers `xvfb-run` if present (required in headless environments), and both tests fail if the launcher exits early during startup.

For the launcher to start Azahar in development, you must either:

1. Place a Windows Azahar 2126.0 build at `desktop/resources/azahar/azahar.exe` before building, **or**
2. Set the `AZAHAR_PATH` environment variable to an existing `azahar.exe`.

The production installer built by CI downloads the pinned official archive, verifies its SHA-256 checksum, bundles it, and audits the unpacked application before publishing the artifact. Tagged `v*` builds additionally require `WINDOWS_CSC_LINK` and `WINDOWS_CSC_KEY_PASSWORD`; CI rejects the release unless Windows reports valid Authenticode signatures for both the application executable and installer.

## Runtime files

The desktop build copies the following into the installer:

- `release/emerald-online-3ds.3dsx` — the project runtime
- `resources/azahar/` — the Azahar emulator (CI-provided)
- `resources/licenses/` — GPL and third-party notices, including the exact Azahar source/checksum reference

The license inputs are deliberately self-contained under `desktop/resources/licenses/`, so `npm run dist` also works when the desktop directory and the sibling `release/` directory are copied outside the repository. It does not depend on `../THIRD_PARTY.md` or `../third_party/gpsp/COPYING`.

## Avatar atlas

The runtime falls back safely when `avatars.t3x` is absent and learns trainer directions from the user's local gameplay. Developers can generate a complete private atlas with `npm run build:private` and copy `generated/sd-card/3ds/emerald-online-3ds/avatars.t3x` into the launcher's virtual SD directory. The atlas, ROM, saves, identity, and configuration are excluded from every installer audit.

## Backups, updates, diagnostics, and deletion

The launcher redirects Azahar's `%APPDATA%` root into its own Electron user-data directory. The ROM, save, identity, settings, logs, and working 3DSX therefore remain isolated from a separately installed Azahar profile. The bundled 3DSX is staged on first launch so in-app updates persist; a later desktop version upgrades only an untouched launcher-managed copy.

**Data & recovery** creates a gzip-compressed, integrity-checked `.eobackup` containing only launcher/runtime settings, `emerald.sav`, `identity.cfg`, `stats.cfg`, `display.cfg`, `avatars.t3x`, and recognized `link-backups/*.sav` files that exist. `emerald.gba`, the 3DSX, debug logs, and update downloads are explicitly excluded. Backups never leave the computer through the launcher, but may contain a private identity and must not be shared. Restore validates every path, size, and SHA-256 before replacing files.

The same panel exports a bounded, redacted text diagnostic without ROM/save/configuration contents, identity values, private addresses, email addresses, or user paths. Unexpected launcher and Azahar exits are recorded as structured events and surface a recovery notice on the next launch.

Update checks are manual. Metadata must come from `https://emeraldonline3ds.com/api/release`; downloads are restricted to the official same-origin desktop route, checked against the published SHA-256, and rejected unless Windows validates their Authenticode signature. Opening the verified installer requires another explicit confirmation.

Uninstall intentionally preserves private data to prevent accidental save loss. **Delete all local data** removes the launcher's ROM, save, online identity, settings, diagnostics, and downloaded updates while leaving backups stored elsewhere. This is application-level deletion, not a guarantee that storage media cannot be forensically recovered.
