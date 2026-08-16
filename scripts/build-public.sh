#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
devkit_image='devkitpro/devkitarm@sha256:116afba8df8453961de2936ffab20dd441edf4d682856c1ec8b0e53d7ed0bbf5'
packaging_image='mgba/3ds@sha256:2adee3ce361b86a4a92e6183fd3c59af614db7a7321d230ed46d7a3522efe4f4'
mgba_commit='26b7884bc25a5933960f3cdcd98bac1ae14d42e2'
tooling_dir="${project_root}/generated/tooling/mgba-${mgba_commit}"
release_dir="${project_root}/release"
version="$(node -p "require('${project_root}/package.json').version")"

mkdir -p "${tooling_dir}" "${release_dir}"

fetch_verified() {
  local url="$1" destination="$2" expected="$3" actual
  if [[ ! -f "${destination}" ]]; then
    curl --fail --silent --show-error --location --retry 3 --output "${destination}.tmp" "${url}"
    mv "${destination}.tmp" "${destination}"
  fi
  actual="$(sha256sum "${destination}" | cut -d' ' -f1)"
  if [[ "${actual}" != "${expected}" ]]; then
    echo "hash mismatch for ${destination}: ${actual}" >&2
    exit 1
  fi
}

fetch_verified \
  "https://raw.githubusercontent.com/mgba-emu/mgba/${mgba_commit}/src/platform/3ds/cia.rsf.in" \
  "${tooling_dir}/cia.rsf.in" \
  '1a48e0df4089ac12040fd6e0591f130422e686877072c5375227802f3fb59ced'
fetch_verified \
  "https://raw.githubusercontent.com/mgba-emu/mgba/${mgba_commit}/src/platform/3ds/bios.wav" \
  "${tooling_dir}/bios.wav" \
  '0939f3354c9309cd1285fe7889ae012f16b29daa20df8cd4d05b4b6f40ba6691'
node "${project_root}/tools/prepare-cia-assets.mjs" "${tooling_dir}/cia.rsf.in" "${tooling_dir}/emerald-online-3ds.rsf"

docker run --rm \
  -e DEVKITPRO=/opt/devkitpro -e DEVKITARM=/opt/devkitpro/devkitARM -e CTRULIB=/opt/devkitpro/libctru \
  -v "${project_root}/third_party/gpsp:/src" -w /src \
  "${devkit_image}" make platform=ctr clean
docker run --rm \
  -e DEVKITPRO=/opt/devkitpro -e DEVKITARM=/opt/devkitpro/devkitARM -e CTRULIB=/opt/devkitpro/libctru \
  -v "${project_root}/third_party/gpsp:/src" -w /src \
  "${devkit_image}" make platform=ctr -j8

docker run --rm \
  -e DEVKITPRO=/opt/devkitpro -e DEVKITARM=/opt/devkitpro/devkitARM -e CTRULIB=/opt/devkitpro/libctru \
  -v "${project_root}:/project" -w /project/gpsp-runtime \
  "${devkit_image}" make clean
docker run --rm \
  -e DEVKITPRO=/opt/devkitpro -e DEVKITARM=/opt/devkitpro/devkitARM -e CTRULIB=/opt/devkitpro/libctru \
  -v "${project_root}:/project" -w /project/gpsp-runtime \
  "${devkit_image}" make -j8

docker run --rm -v "${project_root}:/project" -w /project "${packaging_image}" sh -lc \
  "/opt/devkitpro/devkitARM/bin/arm-none-eabi-strip gpsp-runtime/emerald-online-3ds.elf -o gpsp-runtime/emerald-online-3ds-stripped.elf && \
   /opt/devkitpro/tools/bin/bannertool makebanner -i assets/emerald-online-3ds-banner.png -a generated/tooling/mgba-${mgba_commit}/bios.wav -o gpsp-runtime/emerald-online-3ds.bnr && \
   /opt/devkitpro/tools/bin/makerom -f cia -o gpsp-runtime/emerald-online-3ds.cia -rsf generated/tooling/mgba-${mgba_commit}/emerald-online-3ds.rsf -target t -exefslogo -elf gpsp-runtime/emerald-online-3ds-stripped.elf -icon gpsp-runtime/emerald-online-3ds.smdh -banner gpsp-runtime/emerald-online-3ds.bnr -major 0 -minor 5 -micro 0"

cp "${project_root}/gpsp-runtime/emerald-online-3ds.cia" "${release_dir}/emerald-online-3ds.cia"
cp "${project_root}/gpsp-runtime/emerald-online-3ds.3dsx" "${release_dir}/emerald-online-3ds.3dsx"

source_stage="${project_root}/generated/source-${version}"
rm -rf "${source_stage}"
mkdir -p "${source_stage}/gpsp-runtime" "${source_stage}/third_party"
cp "${project_root}/README.md" "${project_root}/LICENSE.md" "${project_root}/THIRD_PARTY.md" "${project_root}/COMMUNITY_PLATFORM_PLAN.md" \
  "${project_root}/package.json" "${project_root}/package-lock.json" "${source_stage}/"
cp -R "${project_root}/assets" "${project_root}/protocol" "${project_root}/scripts" "${project_root}/tools" "${source_stage}/"
cp "${project_root}/gpsp-runtime/Makefile" "${project_root}/gpsp-runtime/README.md" "${source_stage}/gpsp-runtime/"
cp -R "${project_root}/gpsp-runtime/source" "${source_stage}/gpsp-runtime/"
tar -C "${project_root}/third_party" \
  --exclude='.git' --exclude='*.o' --exclude='*.a' --exclude='*.d' --exclude='build' \
  -cf - gpsp | tar -C "${source_stage}/third_party" -xf -
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
  -C "$(dirname "${source_stage}")" -cf - "$(basename "${source_stage}")" | \
  gzip -n > "${release_dir}/emerald-online-3ds-source-${version}.tar.gz"

(
  cd "${release_dir}"
  sha256sum emerald-online-3ds.cia emerald-online-3ds.3dsx "emerald-online-3ds-source-${version}.tar.gz" > SHA256SUMS
)

echo "Built public artifacts in ${release_dir}"
cat "${release_dir}/SHA256SUMS"
