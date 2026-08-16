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

archive_listing="$(tar -tzf "${source_archive}")"
for required_path in LICENSE.md package.json gpsp-runtime/source/main.cpp third_party/gpsp/COPYING server/src/server.mjs web/install-server.mjs deploy/kubernetes.yaml; do
  grep -Eq "/${required_path}$" <<<"${archive_listing}" || {
    echo "source archive is missing ${required_path}" >&2
    exit 1
  }
done

if grep -Eiq '(^|/)([^/]*\.gba|[^/]*\.sav|online\.cfg|identity\.cfg|stats\.cfg|avatars\.t3x|\.git)(/|$)' <<<"${archive_listing}"; then
  echo "private data or repository metadata found in source archive" >&2
  exit 1
fi
if grep -Eiq '(^|/)([^/]*\.(o|a|d)|build)(/|$)' <<<"${archive_listing}"; then
  echo "generated compiler output found in source archive" >&2
  exit 1
fi

echo "Release audit passed for ${version}."
