# Third-party notices

This application contains no ROM, save, Nintendo system file, or copyrighted
game asset. A user must import the exact supported dump from a cartridge they
legally own.

## Azahar

The iOS build embeds a source-built Azahar 2126.0 libretro core from
https://github.com/azahar-emu/azahar. Azahar is licensed under GPL-2.0.
The build pins Azahar commit `fbd3fb02f71e5f9ed5134037fd59bad96c7d2b8a`,
Dynarmic commit `e77b1ba0b7da7cbe93021b01a663acfe7c4dd516`, and Oaknut
commit `94c726ce0338b054eb8cb5ea91de8fe6c19f4392`.

The corresponding mobile source archive includes the complete reproducible
build script and all project modifications as GPL-compatible patch files. The
changes implement StikDebug's universal iOS 26 executable-region protocol,
persistent W^X CPU-code mappings, and an iOS-native Dynarmic spin lock. Shader
JIT remains disabled on iOS 26 because upstream creates shader code regions
after the debugger has detached.

## Capacitor and React

Capacitor and React are used under their respective permissive licenses. Their
license texts are retained in the installed npm packages and source lockfile.

## GzipSwift

GzipSwift is used under the MIT License for desktop-compatible backup archives.
Its source is available at https://github.com/1024jp/GzipSwift.

## libretro API header

The vendored `libretro.h` API header is taken from the libretro-common revision
pinned by Azahar 2126.0 and retains its original MIT license notice.
