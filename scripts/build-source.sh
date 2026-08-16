#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
version="$(node -p "require('${project_root}/package.json').version")"
[[ "${version}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([+-][A-Za-z0-9.-]+)?$ ]] || { echo 'invalid package version' >&2; exit 1; }
source_stage="${project_root}/generated/source-${version}"
release_dir="${project_root}/release"

rm -rf "${source_stage}"
mkdir -p "${source_stage}/gpsp-runtime" "${source_stage}/third_party" "${release_dir}"
cp "${project_root}/README.md" "${project_root}/LICENSE.md" "${project_root}/THIRD_PARTY.md" \
  "${project_root}/COMMUNITY_PLATFORM_PLAN.md" "${project_root}/ROADMAP.md" \
  "${project_root}/TESTING.md" "${project_root}/PHASE_0_HANDOFF.md" \
  "${project_root}/GATE_1_HANDOFF.md" "${project_root}/GATE_2_HANDOFF.md" \
  "${project_root}/GATE_3_HANDOFF.md" "${project_root}/GATE_4_HANDOFF.md" \
  "${project_root}/BOTTOM_SCREEN_HANDOFF.md" \
  "${project_root}/package.json" "${project_root}/package-lock.json" "${project_root}/Dockerfile" "${source_stage}/"
cp -R "${project_root}/assets" "${project_root}/protocol" "${project_root}/scripts" "${project_root}/tools" \
  "${project_root}/server" "${project_root}/web" "${project_root}/deploy" "${source_stage}/"
cp "${project_root}/gpsp-runtime/Makefile" "${project_root}/gpsp-runtime/README.md" "${source_stage}/gpsp-runtime/"
cp -R "${project_root}/gpsp-runtime/source" "${source_stage}/gpsp-runtime/"
tar -C "${project_root}/third_party" \
  --exclude='.git' --exclude='*.o' --exclude='*.a' --exclude='*.d' --exclude='build' \
  -cf - gpsp | tar -C "${source_stage}/third_party" -xf -
tar --sort=name --mtime='@0' --owner=0 --group=0 --numeric-owner \
  -C "$(dirname "${source_stage}")" -cf - "$(basename "${source_stage}")" | \
  gzip -n > "${release_dir}/emerald-online-3ds-source-${version}.tar.gz"

echo "Built complete first-party and corresponding gpSP source for ${version}."
