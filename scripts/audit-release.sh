#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(node -p "require('${project_root}/package.json').version")"
release_dir="${project_root}/release"
source_archive="${release_dir}/emerald-online-3ds-source-${version}.tar.gz"

required=(
  "${release_dir}/emerald-online-3ds.cia"
  "${release_dir}/emerald-online-3ds.3dsx"
  "${source_archive}"
  "${release_dir}/SHA256SUMS"
)
for artifact in "${required[@]}"; do
  [[ -s "${artifact}" ]] || { echo "missing or empty artifact: ${artifact}" >&2; exit 1; }
done

(cd "${release_dir}" && sha256sum --check SHA256SUMS)
node "${project_root}/server/tools/publish-releases.mjs" --validate-only

archive_listing="$(tar -tzf "${source_archive}")"
for required_path in LICENSE.txt VERSION.txt gpsp-runtime/Makefile gpsp-runtime/source/main.cpp third_party/gpsp/COPYING third_party/gpsp/Makefile; do
  grep -Eq "/${required_path}$" <<<"${archive_listing}" || {
    echo "source archive is missing ${required_path}" >&2
    exit 1
  }
done

if grep -Eiq '(^|/)([^/]*\.md|[^/]*\.gba|[^/]*\.sav|online\.cfg|identity\.cfg|stats\.cfg|avatars\.t3x|\.git[^/]*|\.env[^/]*|[^/]*(secret|credential|token|password)[^/]*)(/|$)' <<<"${archive_listing}"; then
  echo "private data or repository metadata found in source archive" >&2
  exit 1
fi
if grep -Eiq '(^|/)(assets|server|web|deploy|tools|protocol|release|scripts|generated|[^/]*\.(o|a|d|png|jpe?g|gif|svg|t3x|bin)|build)(/|$)' <<<"${archive_listing}"; then
  echo "generated compiler output found in source archive" >&2
  exit 1
fi

audit_dir="$(mktemp -d)"
cleanup_audit_dir() { find "${audit_dir}" -depth -delete; }
trap cleanup_audit_dir EXIT
tar -xzf "${source_archive}" -C "${audit_dir}"
if grep -RIEiq --exclude='COPYING' \
  '((^|[^0-9])(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3})([^0-9]|$)|\.svc\.cluster\.local|kubectl|kubernetes|cloudflare|gitea|vault|minio|lindsey)' \
  "${audit_dir}"; then
  echo "host, infrastructure, or identifying information found in source archive" >&2
  exit 1
fi

echo "Release audit passed for ${version}."
