#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
rom_path="${1:-${project_root}/Pokemon - Emerald Version.gba}"
trainer_name="${TRAINER_NAME:-Trainer}"
server_host="${SERVER_HOST:-live.emeraldonline3ds.com}"
server_port="${SERVER_PORT:-443}"
transport="${TRANSPORT:-wss}"
server_path="${SERVER_PATH:-/game}"
deploy_dir="${project_root}/generated/sd-card/3ds/emerald-online-3ds"
avatar_dir="${project_root}/generated/private-avatar-build"
devkit_image='devkitpro/devkitarm@sha256:116afba8df8453961de2936ffab20dd441edf4d682856c1ec8b0e53d7ed0bbf5'

node "${project_root}/tools/inspect-rom.mjs" "${rom_path}" >/dev/null
node "${project_root}/tools/prepare-private-avatars.mjs" "${rom_path}" "${avatar_dir}"
"${project_root}/scripts/build-public.sh"

docker run --rm -v "${project_root}:/project" -w /project/generated/private-avatar-build \
  "${devkit_image}" tex3ds -i avatars.t3s -o avatars.t3x

mkdir -p "${deploy_dir}"
if [[ ! "${trainer_name}" =~ ^[[:print:]]{1,12}$ || "${trainer_name}" == *'"'* || "${trainer_name}" == *'\'* ]]; then echo 'TRAINER_NAME must be 1-12 printable characters without quotes or backslashes' >&2; exit 1; fi

cp "${project_root}/release/emerald-online-3ds.3dsx" "${deploy_dir}/emerald-online-3ds.3dsx"
cp "${rom_path}" "${deploy_dir}/emerald.gba"
cp "${avatar_dir}/avatars.t3x" "${deploy_dir}/avatars.t3x"
printf 'server=%s\nport=%s\ntransport=%s\npath=%s\nname=%s\n' \
  "${server_host}" "${server_port}" "${transport}" "${server_path}" "${trainer_name}" > "${deploy_dir}/online.cfg"

echo "Prepared private SD package at ${deploy_dir}"
