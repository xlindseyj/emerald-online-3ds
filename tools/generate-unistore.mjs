#!/usr/bin/env node
// Generate a Universal-Updater UniStore manifest for the current release.
// Reads package.json, release/SHA256SUMS, and PUBLIC_BASE_URL to build
// release/emerald-online-3ds.unistore.
//
// Reference: https://github.com/Universal-Team/Universal-Updater/wiki/UniStore-example

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const releaseDir = path.join(root, 'release');
const packageInfo = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = packageInfo.version;
const publicBase = (process.env.PUBLIC_BASE_URL ?? 'https://emeraldonline3ds.com').replace(/\/$/, '');
const unistorePath = path.join(releaseDir, 'emerald-online-3ds.unistore');

function readChecksums() {
  const sums = {};
  const content = fs.readFileSync(path.join(releaseDir, 'SHA256SUMS'), 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) sums[parts[1]] = parts[0];
  }
  return sums;
}

const checksums = readChecksums();
const now = new Date();
const lastUpdated = now.toISOString().replace('T', ' at ').slice(0, -5) + ' (UTC)';

const manifest = {
  storeInfo: {
    title: 'Emerald Online 3DS',
    author: 'Emerald Online 3DS',
    description: 'Public multiplayer presence for your own Pokémon Emerald cartridge dump on Nintendo 3DS.',
    url: `${publicBase}/emerald-online-3ds.unistore`,
    file: 'emerald-online-3ds.unistore',
    revision: 1,
    version: 4
  },
  storeContent: [
    {
      info: {
        title: 'Emerald Online 3DS',
        author: 'Emerald Online 3DS',
        description: `Public multiplayer presence, chat, and RFU/Union Room relay for Pokémon Emerald (US) on 3DS. Release v${version}.`,
        category: ['game'],
        console: ['3DS'],
        last_updated: lastUpdated,
        license: 'gpl-3.0',
        version: `v${version}`
      },
      [`Emerald Online 3DS v${version} (3DSX)`]: [
        {
          type: 'downloadFile',
          file: `${publicBase}/emerald-online-3ds.3dsx`,
          output: '%3DSX%/emerald-online-3ds.3dsx',
          message: `Downloading emerald-online-3ds v${version} 3DSX...`
        }
      ],
      [`Emerald Online 3DS v${version} (CIA)`]: [
        {
          type: 'downloadFile',
          file: `${publicBase}/emerald-online-3ds.cia`,
          output: 'sdmc:/emerald-online-3ds.cia',
          message: `Downloading emerald-online-3ds v${version} CIA...`
        },
        {
          type: 'installCia',
          file: '/emerald-online-3ds.cia'
        },
        {
          type: 'deleteFile',
          file: 'sdmc:/emerald-online-3ds.cia'
        }
      ]
    }
  ]
};

// Include SHA-256 hashes from the release checksums when available.
for (const entry of manifest.storeContent) {
  const ciaHash = checksums['emerald-online-3ds.cia'];
  const dsxHash = checksums['emerald-online-3ds.3dsx'];
  if (ciaHash) {
    const ciaAction = entry[`Emerald Online 3DS v${version} (CIA)`][0];
    ciaAction.sha256 = ciaHash;
  }
  if (dsxHash) {
    const dsxAction = entry[`Emerald Online 3DS v${version} (3DSX)`][0];
    dsxAction.sha256 = dsxHash;
  }
}

fs.writeFileSync(unistorePath, JSON.stringify(manifest, null, 2));
console.log(`Generated ${unistorePath}`);
console.log(`  base: ${publicBase}`);
console.log(`  3DSX: ${checksums['emerald-online-3ds.3dsx'] ?? 'missing hash'}`);
console.log(`  CIA:  ${checksums['emerald-online-3ds.cia'] ?? 'missing hash'}`);
