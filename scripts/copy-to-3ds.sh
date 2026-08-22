#!/usr/bin/env bash
# Copy the current release CIA and 3DSX to a physical 3DS running an FTP server.
# Usage: copy-to-3ds.sh <3ds-ip> [ftp-port]
# The 3DS FTP server is expected to be anonymous and exposes the SD card root.
# Files are placed in the standard Homebrew Launcher / FBI install locations.
set -euo pipefail

IP="${1:-}"
PORT="${2:-5000}"

if [ -z "$IP" ]; then
    echo "Usage: $0 <3ds-ip> [ftp-port]" >&2
    exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CIA="$ROOT/release/emerald-online-3ds.cia"
THREEDSX="$ROOT/release/emerald-online-3ds.3dsx"

if [ ! -f "$CIA" ] || [ ! -f "$THREEDSX" ]; then
    echo "Release artifacts missing. Run: npm run build:private" >&2
    exit 1
fi

FTP_URL="ftp://$IP:$PORT"

echo "Copying CIA to $FTP_URL/cias/ ..."
curl -T "$CIA" "$FTP_URL/cias/emerald-online-3ds.cia"

echo "Copying 3DSX to $FTP_URL/3ds/emerald-online-3ds/ ..."
curl -T "$THREEDSX" "$FTP_URL/3ds/emerald-online-3ds/emerald-online-3ds.3dsx"

echo "Done. On the 3DS, install the CIA with FBI and/or launch the 3DSX from the Homebrew Launcher."
