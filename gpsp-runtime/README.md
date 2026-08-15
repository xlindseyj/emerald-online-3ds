# Emerald Online gpSP runtime

This is the dedicated Old 3DS runtime. It statically links the 3DS build of
the libretro gpSP core, boots only the user's private Emerald dump, and owns
both 3DS screens directly. RetroArch is not included and no generic ROM picker
is exposed.

Runtime files remain under `sd:/3ds/emerald-online-3ds/`:

- `emerald.gba` — the user's validated legal dump; never embedded in the CIA
- `emerald.sav` — a standard 128 KiB Emerald flash save
- `online.cfg` — public endpoint, transport, path, trainer-name fallback, and runtime options
- `identity.cfg` — private server-issued identity, device credential, and display fingerprint; created atomically on first v2 enrollment

The production build enables gpSP's ARM dynarec. `dynarec=disabled` is accepted
only as a diagnostic fallback because Azahar does not implement the Rosalina
custom cache-invalidation SVC used by the dynarec.

The CIA uses the same Luma backdoor bootstrap model as RetroArch's 3DS
frontend, then maps gpSP's translation caches with explicit result checking.
The top framebuffer is padded to 256x256 before a tiled GPU transfer and drawn
at 400x240. The main loop relies on Citro3D synchronization alone; adding a
second explicit VBlank wait reduces physical Old 3DS performance to 30 FPS.

As of 2026-08-14, a blue Old 3DS XL boots the pre-v2 runtime at 60 FPS, renders the
lower dashboard correctly, plays smooth 32768 Hz audio, and reaches the LAN
server. Server telemetry confirms the runtime completed its authenticated
protocol hello and publishes live overworld map/tile state. The dedicated
frontend binds gpSP's exported EWRAM and its offset-corrected IWRAM directly,
with libretro memory descriptors retained as a compatible secondary path.

Version 0.4.0 defaults to certificate-validated WSS at
`wss://live.emeraldonline3ds.com/game`. It requests a server-issued v2 identity
on first connection, displays the one-time recovery code for the enrollment
session, and reuses the saved credential after reconnects. Preserve
`identity.cfg` across upgrades; deleting it intentionally enrolls a new identity.

The private build locates the exact Brendan and May walking graphics and
palettes inside the validated Emerald ROM, decodes nine frames for each, and
creates `avatars.t3x` beside the ROM on the SD card. SaveBlock2 gender selects
which sheet other clients render. The atlas is not part of the CIA and its
pixels are never transmitted by the presence protocol.

gpSP is GPL-2.0 licensed. Its corresponding source and license are vendored at
`third_party/gpsp/`; upstream is <https://github.com/libretro/gpsp>.
