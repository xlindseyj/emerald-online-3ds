import fsp from 'node:fs/promises';
import path from 'node:path';
import { validateReleaseCatalog } from '../src/release-catalog.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const packageInfo = JSON.parse(await fsp.readFile(path.join(root, 'package.json'), 'utf8'));
const catalogPath = path.join(root, 'release', 'release-catalog.json');
const checksums = new Map((await fsp.readFile(path.join(root, 'release', 'SHA256SUMS'), 'utf8')).trim().split('\n').map(line => {
  const match = line.match(/^([a-f0-9]{64})  (.+)$/);
  if (!match) throw new Error(`invalid SHA256SUMS line: ${line}`);
  return [match[2], match[1]];
}));
const raw = JSON.parse(await fsp.readFile(catalogPath, 'utf8'));
const current = raw.find(release => release.version === packageInfo.version);
if (!current) throw new Error(`release catalog has no ${packageInfo.version} entry`);
const filenames = {
  CIA: 'emerald-online-3ds.cia',
  '3DSX': 'emerald-online-3ds.3dsx',
  'Corresponding source': `emerald-online-3ds-source-${packageInfo.version}.tar.gz`
};
for (const artifact of current.artifacts ?? []) {
  const filename = filenames[artifact.label];
  if (filename && checksums.has(filename)) artifact.sha256 = checksums.get(filename);
}
validateReleaseCatalog(raw);
await fsp.writeFile(catalogPath, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o644 });
console.log(`Synchronized ${packageInfo.version} release catalog hashes.`);
