#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(cd "${project_root}" && node -p "require('./package.json').version")"
[[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][A-Za-z0-9.-]+)?$ ]] || { echo 'invalid package version' >&2; exit 1; }
source_stage="${project_root}/generated/source-${version}"
release_dir="${project_root}/release"

if [[ -d "${source_stage}" ]]; then
  find "${source_stage}" -depth -delete
fi
mkdir -p "${source_stage}/gpsp-runtime" "${source_stage}/third_party" "${release_dir}"
cat > "${source_stage}/LICENSE.txt" <<'EOF'
Emerald Online 3DS runtime source license

The first-party 3DS runtime source linked with gpSP is distributed under the
GNU General Public License, version 2 only (GPL-2.0-only). The complete GPLv2
license text is included at third_party/gpsp/COPYING.

No license is granted for Pokemon ROMs, saves, copyrighted game artwork,
audio, trademarks, or other user-supplied game content. Those materials are
not part of this source package and must not be redistributed.
EOF
printf '%s\n' "${version}" > "${source_stage}/VERSION.txt"
cp "${project_root}/gpsp-runtime/Makefile" "${source_stage}/gpsp-runtime/"
cp -R "${project_root}/gpsp-runtime/source" "${source_stage}/gpsp-runtime/"
tar -C "${project_root}/third_party" \
  --exclude-vcs --exclude='.*' --exclude='*.md' --exclude='*.o' --exclude='*.a' --exclude='*.d' \
  --exclude='*.bin' --exclude='build' --exclude='gpsp/tools' \
  -cf - gpsp | tar -C "${source_stage}/third_party" -xf -
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
  -C "$(dirname "${source_stage}")" -cf - "$(basename "${source_stage}")" | \
  gzip -n > "${release_dir}/emerald-online-3ds-source-${version}.tar.gz"

echo "Built code-only 3DS runtime and corresponding gpSP source for ${version}."
