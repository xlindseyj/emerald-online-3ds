import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateRoom, prepareLinkTest, validateRoom } from '../../tools/prepare-link-test.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..', '..');

test('link test room codes are unambiguous and strictly validated', () => {
  assert.match(generateRoom(), /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(validateRoom('abcd-2345'), 'ABCD-2345');
  assert.throws(() => validateRoom('TEST-1234'), /format/);
  assert.throws(() => validateRoom('../private'), /format/);
});

test('physical link bundle preserves private device data and prepares an isolated Azahar peer', t => {
  const saveDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-link-save-'));
  const savePath = path.join(saveDirectory, 'emerald.sav');
  fs.writeFileSync(savePath, Buffer.alloc(128 * 1024, 0x5a));
  const output = path.join(projectRoot, 'generated', `link-test-unit-${process.pid}-${Date.now()}`);
  t.after(() => { fs.rmSync(output, { recursive: true, force: true }); fs.rmSync(saveDirectory, { recursive: true, force: true }); });

  const result = prepareLinkTest({ projectRoot, outputDirectory: output, room: 'ABCD-2345', savePath });
  assert.equal(result.emulatorSaveIncluded, true);
  assert.equal(fs.statSync(path.join(result.physicalSd, '3ds', 'emerald-online-3ds', 'emerald-online-3ds.3dsx')).size,
    fs.statSync(path.join(projectRoot, 'release', 'emerald-online-3ds.3dsx')).size);
  assert.match(fs.readFileSync(path.join(result.physicalSd, '3ds', 'emerald-online-3ds', 'online.cfg'), 'utf8'), /link_room=ABCD-2345/);
  assert.equal(fs.existsSync(path.join(result.physicalSd, '3ds', 'emerald-online-3ds', 'identity.cfg')), false);
  assert.equal(fs.existsSync(path.join(result.physicalSd, '3ds', 'emerald-online-3ds', 'emerald.gba')), false);
  assert.equal(fs.statSync(path.join(result.azaharProfile, 'data', 'azahar-emu', 'sdmc', '3ds', 'emerald-online-3ds', 'emerald.sav')).size, 128 * 1024);
  assert.throws(() => prepareLinkTest({ projectRoot, outputDirectory: path.join(os.tmpdir(), 'outside-generated'), room: 'ABCD-2345', savePath }), /under generated/);
});
