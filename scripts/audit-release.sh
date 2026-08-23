#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(cd "${project_root}" && node -p "require('./package.json').version")"
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

(cd "${release_dir}" && sha256sum --check --ignore-missing SHA256SUMS)
# The Windows desktop installer is produced by the Windows CI job and lives in
# desktop/dist; verify it separately against the SHA256SUMS entry.
desktop_installer="${project_root}/desktop/dist/EmeraldOnline3DS-Setup-${version}.exe"
expected_desktop_sha="$(awk '$2 == "EmeraldOnline3DS-Setup-'"${version}"'.exe" {print $1}' "${release_dir}/SHA256SUMS")"
if [[ -n "${expected_desktop_sha}" ]]; then
  [[ -s "${desktop_installer}" ]] || { echo "missing or empty desktop installer: ${desktop_installer}" >&2; exit 1; }
  actual_desktop_sha="$(sha256sum "${desktop_installer}" | cut -d' ' -f1)"
  [[ "${actual_desktop_sha}" == "${expected_desktop_sha}" ]] || { echo "desktop installer checksum mismatch" >&2; exit 1; }
fi
# The signed iOS build is optional, but once staged for the SideStore source it
# must be checksummed and pass the ROM/private-data IPA audit.
ios_ipa="${release_dir}/emerald-online-3ds-ios.ipa"
expected_ios_sha="$(awk '$2 == "emerald-online-3ds-ios.ipa" {print $1}' "${release_dir}/SHA256SUMS")"
if [[ -e "${ios_ipa}" || -n "${expected_ios_sha}" ]]; then
  [[ -s "${ios_ipa}" ]] || { echo "missing or empty iOS IPA: ${ios_ipa}" >&2; exit 1; }
  [[ -n "${expected_ios_sha}" ]] || { echo "iOS IPA is missing from release/SHA256SUMS" >&2; exit 1; }
  actual_ios_sha="$(sha256sum "${ios_ipa}" | cut -d' ' -f1)"
  [[ "${actual_ios_sha}" == "${expected_ios_sha}" ]] || { echo "iOS IPA checksum mismatch" >&2; exit 1; }
  node "${project_root}/mobile/tools/audit-ipa.mjs" "${ios_ipa}"
fi
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
  '((^|[^0-9])(10\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|192\.168\.[0-9]{1,3}\.[0-9]{1,3}|172\.(1[6-9]|2[0-9]|3[01])\.[0-9]{1,3}\.[0-9]{1,3})([^0-9]|$)|\.svc\.cluster\.local|kubectl|kubernetes|cloudflare|gitea|vault|minio|internal-registry|private-node)' \
  "${audit_dir}"; then
  echo "host, infrastructure, or identifying information found in source archive" >&2
  exit 1
fi

echo "Release audit passed for ${version}."
