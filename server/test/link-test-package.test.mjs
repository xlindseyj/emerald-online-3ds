import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateRoom, prepareLinkTest, validateRoom } from '../../tools/prepare-link-test.mjs';
import { inspectEmeraldSave } from '../../tools/emerald-save.mjs';

const projectRoot = path.resolve(import.meta.dirname, '..', '..');

function sectionChecksum(data, size) {
  let sum = 0;
  for (let offset = 0; offset < size; offset += 4) sum = (sum + data.readUInt32LE(offset)) >>> 0;
  return ((sum >>> 16) + (sum & 0xFFFF)) & 0xFFFF;
}

function validTestSave() {
  const sizes = [0xF2C, 0xF80, 0xF80, 0xF80, 0xF08, 0xF80, 0xF80, 0xF80, 0xF80, 0xF80, 0xF80, 0xF80, 0xF80, 0x7D0];
  const save = Buffer.alloc(128 * 1024, 0xFF);
  for (let slot = 0; slot < 2; slot += 1) {
    for (let id = 0; id < 14; id += 1) {
      const sector = Buffer.alloc(0x1000);
      if (id === 0) { sector.writeUInt16LE(1, 0x0E); sector[0x10] = 5; }
      if (id === 1) {
        sector.writeInt16LE(12, 0x00); sector.writeInt16LE(8, 0x02);
        sector.writeInt8(2, 0x04); sector.writeInt8(3, 0x05); sector[0x234] = 1;
      }
      sector.writeUInt16LE(id, 0xFF4);
      sector.writeUInt16LE(sectionChecksum(sector, sizes[id]), 0xFF6);
      sector.writeUInt32LE(0x08012025, 0xFF8);
      sector.writeUInt32LE(slot + 1, 0xFFC);
      sector.copy(save, (slot * 14 + id) * 0x1000);
    }
  }
  return save;
}

test('link test room codes are unambiguous and strictly validated', () => {
  assert.match(generateRoom(), /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  assert.equal(validateRoom('abcd-2345'), 'ABCD-2345');
  assert.throws(() => validateRoom('TEST-1234'), /format/);
  assert.throws(() => validateRoom('../private'), /format/);
});

test('physical link bundle preserves private device data and prepares an isolated Azahar peer', t => {
  const saveDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'emerald-link-save-'));
  const savePath = path.join(saveDirectory, 'emerald.sav');
  fs.writeFileSync(savePath, validTestSave());
  const output = path.join(projectRoot, 'generated', `link-test-unit-${process.pid}-${Date.now()}`);
  t.after(() => { fs.rmSync(output, { recursive: true, force: true }); fs.rmSync(saveDirectory, { recursive: true, force: true }); });

  const result = prepareLinkTest({ projectRoot, outputDirectory: output, room: 'ABCD-2345', savePath });
  assert.equal(result.emulatorSaveIncluded, true);
  assert.equal(fs.statSync(path.join(result.physicalSd, '3ds', 'emerald-online-3ds', 'emerald-online-3ds.3dsx')).size,
    fs.statSync(path.join(projectRoot, 'release', 'emerald-online-3ds.3dsx')).size);
  assert.match(fs.readFileSync(path.join(result.physicalSd, '3ds', 'emerald-online-3ds', 'online.cfg'), 'utf8'), /link_room=ABCD-2345/);
  assert.doesNotMatch(fs.readFileSync(path.join(result.physicalSd, '3ds', 'emerald-online-3ds', 'online.cfg'), 'utf8'), /dynarec=disabled/);
  assert.equal(fs.existsSync(path.join(result.physicalSd, '3ds', 'emerald-online-3ds', 'identity.cfg')), false);
  assert.equal(fs.existsSync(path.join(result.physicalSd, '3ds', 'emerald-online-3ds', 'emerald.gba')), false);
  assert.equal(fs.statSync(path.join(result.azaharProfile, 'data', 'azahar-emu', 'sdmc', '3ds', 'emerald-online-3ds', 'emerald.sav')).size, 128 * 1024);
  assert.match(fs.readFileSync(path.join(result.azaharProfile, 'data', 'azahar-emu', 'sdmc', '3ds', 'emerald-online-3ds', 'online.cfg'), 'utf8'), /dynarec=disabled/);
  assert.equal(result.emulatorSaveValidated, true);
  assert.equal(result.saveProgress.partyCount, 1);
  assert.throws(() => prepareLinkTest({ projectRoot, outputDirectory: path.join(os.tmpdir(), 'outside-generated'), room: 'ABCD-2345', savePath }), /under generated/);
});

test('Emerald save inspection requires complete checksummed slots and progressed state', () => {
  const inspected = inspectEmeraldSave(validTestSave());
  assert.deepEqual(inspected, {
    validSlotCount: 2, activeSlot: 2, saveCounter: 2, playTimeMinutes: 65,
    partyCount: 1, mapGroup: 2, mapNumber: 3, x: 12, y: 8, progressed: true
  });
  const corrupt = validTestSave();
  corrupt.fill(0, 0xFF8, 0xFFC);
  corrupt.fill(0, 14 * 0x1000 + 0xFF8, 14 * 0x1000 + 0xFFC);
  assert.throws(() => inspectEmeraldSave(corrupt), /no complete checksum-valid save slot/);
  assert.throws(() => inspectEmeraldSave(Buffer.alloc(10)), /131072 or 131584 bytes/);
});
