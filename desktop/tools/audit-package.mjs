import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(desktopRoot, '..');
const sourceMode = process.argv[2] === '--source';
const packageRoot = sourceMode
  ? null
  : path.resolve(process.cwd(), process.argv[2] ?? path.join('dist', 'win-unpacked'));

function requireFile(filePath, minimumBytes, label) {
  assert.ok(fs.existsSync(filePath), `${label} is missing: ${filePath}`);
  const size = fs.statSync(filePath).size;
  assert.ok(size >= minimumBytes, `${label} is unexpectedly small (${size} bytes): ${filePath}`);
}

function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const item = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(item) : [item];
  });
}

const resources = sourceMode ? path.join(desktopRoot, 'resources') : path.join(packageRoot, 'resources');
const azahar = path.join(resources, 'azahar');
const runtime = sourceMode
  ? path.join(projectRoot, 'release', 'emerald-online-3ds.3dsx')
  : path.join(resources, 'runtime', 'emerald-online-3ds.3dsx');

requireFile(path.join(azahar, 'azahar.exe'), 20_000_000, 'Azahar executable');
requireFile(path.join(azahar, 'Qt6Core.dll'), 5_000_000, 'Azahar Qt runtime');
requireFile(path.join(azahar, 'plugins', 'platforms', 'qwindows.dll'), 500_000, 'Azahar Windows platform plugin');
requireFile(runtime, 100_000, 'Emerald Online 3DS runtime');
requireFile(path.join(desktopRoot, 'resources', 'licenses', 'AZAHAR-NOTICE.txt'), 500, 'Azahar redistribution notice');
requireFile(path.join(desktopRoot, 'resources', 'licenses', 'GPL-2.0.txt'), 15_000, 'GPL license');
requireFile(path.join(desktopRoot, 'resources', 'licenses', 'THIRD_PARTY.md'), 500, 'Third-party notice');

if (!sourceMode) {
  requireFile(path.join(resources, 'app.asar'), 20_000, 'Electron application archive');
  requireFile(path.join(resources, 'licenses', 'GPL-2.0.txt'), 15_000, 'GPL license');
  requireFile(path.join(resources, 'licenses', 'THIRD_PARTY.md'), 500, 'Third-party notice');
}

const forbiddenNames = /(?:^|[\\/])(?:emerald\.gba|[^\\/]+\.sav|identity\.cfg|online\.cfg|stats\.cfg|avatars\.t3x)$/i;
for (const file of walk(sourceMode ? desktopRoot : packageRoot)) {
  assert.ok(!forbiddenNames.test(file), `private or user-supplied file entered the desktop package: ${file}`);
}

console.log(JSON.stringify({
  ok: true,
  mode: sourceMode ? 'source' : 'packaged',
  azahar: '2126.0',
  runtime: path.basename(runtime),
  privateFilesFound: 0
}));
