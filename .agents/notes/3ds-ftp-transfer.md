# Physical 3DS file transfer (FTP)

How to copy a freshly built release to a physical 3DS for testing.

## Endpoint

- Protocol: FTP
- Default IP: `192.168.0.9` (confirm with the user — it can change)
- Port: `5000`
- Authentication: anonymous, no password

## Files to copy

| Local file | Remote destination |
|---|---|
| `release/emerald-online-3ds.cia` | `ftp://<ip>:5000/cias/emerald-online-3ds.cia` |
| `release/emerald-online-3ds.3dsx` | `ftp://<ip>:5000/3ds/emerald-online-3ds/emerald-online-3ds.3dsx` |

## Commands

```sh
curl -T release/emerald-online-3ds.cia ftp://192.168.0.9:5000/cias/emerald-online-3ds.cia --user anonymous:
curl -T release/emerald-online-3ds.3dsx ftp://192.168.0.9:5000/3ds/emerald-online-3ds/emerald-online-3ds.3dsx --user anonymous:
```

## Verify the copy

```sh
curl --user anonymous: ftp://192.168.0.9:5000/cias/
curl --user anonymous: ftp://192.168.0.9:5000/3ds/emerald-online-3ds/
```

Expected sizes for a current build:
- CIA: ~1,044,928 bytes
- 3DSX: ~1,328,600 bytes

## Do not overwrite

Leave these files alone on the device:
- `3ds/emerald-online-3ds/online.cfg`
- `3ds/emerald-online-3ds/identity.cfg`
- `3ds/emerald-online-3ds/stats.cfg`
- `3ds/emerald-online-3ds/emerald.gba`
- `3ds/emerald-online-3ds/emerald.sav`
- `3ds/emerald-online-3ds/avatars.t3x`

## After transfer

1. Install the CIA with FBI.
2. Launch either the installed title or the 3DSX.
3. Confirm `LINK <room> ACTIVE - BACKUP OK` on both clients before entering the Wireless Club / Union Room.
