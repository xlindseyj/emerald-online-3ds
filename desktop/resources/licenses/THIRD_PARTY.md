# Third-party components

## mGBA packaging assets

mGBA commit `26b7884bc25a5933960f3cdcd98bac1ae14d42e2` is pinned as the source of the 3DS packaging RSF template and BIOS-wave banner asset under the Mozilla Public License 2.0. The build downloads those two files and verifies their SHA-256 hashes; mGBA itself is neither vendored nor used as the gameplay engine.

## gpSP and RetroArch bootstrap

The actual-game runtime statically links libretro gpSP under GPL-2.0. Corresponding source and license material are vendored under `third_party/gpsp`. A minimal Luma SVC bootstrap is derived from RetroArch's GPL-licensed 3DS frontend; the project retains the adapted source in `gpsp-runtime/source` rather than distributing an unrelated RetroArch checkout.

## pokeemerald reference

The public build does not contain a pokeemerald checkout. Runtime offsets for the single supported US Emerald revision are documented in project source. ROM-derived and generated content remains private and ignored.
