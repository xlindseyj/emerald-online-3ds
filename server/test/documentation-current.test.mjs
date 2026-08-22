import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const packageVersion = JSON.parse(read('package.json')).version;
const escapedVersion = packageVersion.replaceAll('.', '\\.');
const sha256 = relative => createHash('sha256')
  .update(fs.readFileSync(path.join(root, relative)))
  .digest('hex');

test('current documentation follows the release version and artifact hashes', () => {
  const readme = read('README.md');
  const testing = read('TESTING.md');
  const plan = read('COMMUNITY_PLATFORM_PLAN.md');
  const handoff = read('GATE_4_HANDOFF.md');
  const physical = read('GATE_4_PHYSICAL_TEST.md');

  assert.match(readme, new RegExp(`Version ${escapedVersion}`));
  assert.match(testing, new RegExp(`current public release is ${escapedVersion}`));
  assert.match(plan, new RegExp(`Gate 4: feasibility transport remains experimental in release ${escapedVersion}`));
  assert.match(handoff, new RegExp(`Current release ${escapedVersion}`));
  assert.match(physical, new RegExp('Release: `' + escapedVersion + '`'));

  const artifacts = [
    'release/emerald-online-3ds.cia',
    'release/emerald-online-3ds.3dsx',
    `release/emerald-online-3ds-source-${packageVersion}.tar.gz`,
  ];
  for (const artifact of artifacts) {
    const hash = sha256(artifact);
    assert.match(handoff, new RegExp(hash));
    assert.match(physical, new RegExp(hash));
  }

  for (const document of [readme, testing, plan, handoff, physical]) {
    assert.match(document, /RFU/);
    assert.match(document, /Union Room/);
  }
});
