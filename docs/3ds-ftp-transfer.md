# 3DS artifact transfer notes

When the server or runtime changes need to be tested on a physical device, copy the freshly built release files to the 3DS SD card over FTP.

## Connection details

- **Protocol:** FTP (plain, no encryption)
- **Address:** `192.168.0.9`
- **Port:** `5000`
- **Authentication:** none (no username / password)
- **Only the IP changes sometimes; port, paths, and auth stay the same.**

## Files to copy

Copy these two files from the repo into the matching SD-card directories:

| Local file | Remote path |
|------------|-------------|
| `release/emerald-online-3ds.cia` | `ftp://<ip>:5000/cias/emerald-online-3ds.cia` |
| `release/emerald-online-3ds.3dsx` | `ftp://<ip>:5000/3ds/emerald-online-3ds/emerald-online-3ds.3dsx` |

## curl command

```sh
IP=192.168.0.44
PORT=5000
curl -T release/emerald-online-3ds.cia "ftp://${IP}:${PORT}/cias/emerald-online-3ds.cia" --ftp-create-dirs
curl -T release/emerald-online-3ds.3dsx "ftp://${IP}:${PORT}/3ds/emerald-online-3ds/emerald-online-3ds.3dsx" --ftp-create-dirs
```

## What to leave alone on the SD card

Do **not** overwrite:

- `identity.cfg`
- `stats.cfg`
- the Emerald ROM
- the Emerald save
- the avatar atlas (`avatar.png` / atlas files)

## After copying

1. Install the CIA from `cias/` with FBI if you want the HOME Menu title updated.
2. Launch the 3DSX from the Homebrew Launcher for quick iteration without reinstalling.
3. Toggle online off and back on so the client reconnects to the freshly deployed server.
