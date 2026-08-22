#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
devkit_image='devkitpro/devkitarm@sha256:116afba8df8453961de2936ffab20dd441edf4d682856c1ec8b0e53d7ed0bbf5'
packaging_image='mgba/3ds@sha256:2adee3ce361b86a4a92e6183fd3c59af614db7a7321d230ed46d7a3522efe4f4'
mgba_commit='26b7884bc25a5933960f3cdcd98bac1ae14d42e2'
tooling_dir="${project_root}/generated/tooling/mgba-${mgba_commit}"
release_dir="${project_root}/release"
version="$(cd "${project_root}" && node -p "require('./package.json').version")"
IFS=. read -r version_major version_minor version_micro <<<"${version}"
if [[ ! "${version_major}" =~ ^[0-9]+$ || ! "${version_minor}" =~ ^[0-9]+$ || ! "${version_micro}" =~ ^[0-9]+$ ]]; then
  echo "package version must be a numeric major.minor.micro value" >&2
  exit 1
fi

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

MSYS_NO_PATHCONV=1 docker run --rm \
  -e DEVKITPRO=/opt/devkitpro -e DEVKITARM=/opt/devkitpro/devkitARM -e CTRULIB=/opt/devkitpro/libctru \
  -v "${project_root}/third_party/gpsp:/src" -w /src \
  "${devkit_image}" make platform=ctr clean
MSYS_NO_PATHCONV=1 docker run --rm \
  -e DEVKITPRO=/opt/devkitpro -e DEVKITARM=/opt/devkitpro/devkitARM -e CTRULIB=/opt/devkitpro/libctru \
  -v "${project_root}/third_party/gpsp:/src" -w /src \
  "${devkit_image}" make platform=ctr -j8

MSYS_NO_PATHCONV=1 docker run --rm \
  -e DEVKITPRO=/opt/devkitpro -e DEVKITARM=/opt/devkitpro/devkitARM -e CTRULIB=/opt/devkitpro/libctru \
  -v "${project_root}:/project" -w /project/gpsp-runtime \
  "${devkit_image}" make clean
MSYS_NO_PATHCONV=1 docker run --rm \
  -e DEVKITPRO=/opt/devkitpro -e DEVKITARM=/opt/devkitpro/devkitARM -e CTRULIB=/opt/devkitpro/libctru \
  -v "${project_root}:/project" -w /project/gpsp-runtime \
  "${devkit_image}" make -j8

MSYS_NO_PATHCONV=1 docker run --rm -v "${project_root}:/project" -w /project "${packaging_image}" sh -lc \
  "/opt/devkitpro/devkitARM/bin/arm-none-eabi-strip gpsp-runtime/emerald-online-3ds.elf -o gpsp-runtime/emerald-online-3ds-stripped.elf && \
   /opt/devkitpro/tools/bin/bannertool makebanner -i assets/emerald-online-3ds-banner.png -a generated/tooling/mgba-${mgba_commit}/bios.wav -o gpsp-runtime/emerald-online-3ds.bnr && \
   /opt/devkitpro/tools/bin/makerom -f cia -o gpsp-runtime/emerald-online-3ds.cia -rsf generated/tooling/mgba-${mgba_commit}/emerald-online-3ds.rsf -target t -exefslogo -elf gpsp-runtime/emerald-online-3ds-stripped.elf -icon gpsp-runtime/emerald-online-3ds.smdh -banner gpsp-runtime/emerald-online-3ds.bnr -major ${version_major} -minor ${version_minor} -micro ${version_micro}"

cp "${project_root}/gpsp-runtime/emerald-online-3ds.cia" "${release_dir}/emerald-online-3ds.cia"
cp "${project_root}/gpsp-runtime/emerald-online-3ds.3dsx" "${release_dir}/emerald-online-3ds.3dsx"

"${project_root}/scripts/build-source.sh"

(
  cd "${release_dir}"
  sha256sum --text emerald-online-3ds.cia emerald-online-3ds.3dsx "emerald-online-3ds-source-${version}.tar.gz" > SHA256SUMS
)

node "${project_root}/tools/generate-unistore.mjs"

node "${project_root}/server/tools/sync-release-catalog.mjs"
node "${project_root}/server/tools/publish-releases.mjs" --validate-only

echo "Built public artifacts in ${release_dir}"
cat "${release_dir}/SHA256SUMS"
