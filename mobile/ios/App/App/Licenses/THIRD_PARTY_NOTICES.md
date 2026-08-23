# Third-party notices

This application contains no ROM, save, Nintendo system file, or copyrighted
game asset. A user must import the exact supported dump from a cartridge they
legally own.

## Azahar

The iOS build embeds the unmodified Azahar 2126.0 libretro core from
https://github.com/azahar-emu/azahar. Azahar is licensed under GPL-2.0.
Corresponding source for the pinned release is available at
https://github.com/azahar-emu/azahar/tree/2126.0.

The build verifies the published archive before embedding it:

- Archive SHA-256: `e7b3e888db0441d6e3463bd6f38a48e84dcb0009ef58376f23781420beccf479`
- Core SHA-256: `84fa14f88666961f56bc36675018d35e42499ed7410f32d2bb0395bf31855ce6`

## Capacitor and React

Capacitor and React are used under their respective permissive licenses. Their
license texts are retained in the installed npm packages and source lockfile.

## GzipSwift

GzipSwift is used under the MIT License for desktop-compatible backup archives.
Its source is available at https://github.com/1024jp/GzipSwift.

## libretro API header

The vendored `libretro.h` API header is taken from the libretro-common revision
pinned by Azahar 2126.0 and retains its original MIT license notice.
