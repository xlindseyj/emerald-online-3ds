import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { inspectRom, validateRom } from '../src/rom-validator.mjs';

function makeSyntheticEmeraldBuffer() {
  const buffer = Buffer.alloc(16 * 1024 * 1024, 0);
  // Title
  buffer.write('POKEMON EMER', 0xA0);
  // Game code BPEE
  buffer.write('BPEE', 0xAC);
  // Maker code 01
  buffer.write('01', 0xB0);
  // Version 0
  buffer[0xBC] = 0;
  // Compute header checksum
  let checksum = 0;
  for (let i = 0xA0; i <= 0xBC; i++) checksum = (checksum - buffer[i]) & 0xff;
  checksum = (checksum - 0x19) & 0xff;
  buffer[0xBD] = checksum;
  return buffer;
}

describe('rom-validator', () => {
  it('can inspect a ROM entirely from packaged code', () => {
    const info = inspectRom(makeSyntheticEmeraldBuffer());
    assert.equal(info.identityValid, true);
    assert.equal(info.supported, false);
  });

  it('identifies a synthetic ROM with valid Emerald header', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eo3ds-rom-test-'));
    const romPath = path.join(tmpDir, 'emerald.gba');
    fs.writeFileSync(romPath, makeSyntheticEmeraldBuffer());

    const info = await validateRom(romPath);
    assert.equal(info.identityValid, true);
    assert.equal(info.gameCode, 'BPEE');
    assert.equal(info.makerCode, '01');
    assert.equal(info.version, 0);
    assert.equal(info.supported, false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('rejects a non-GBA-sized file', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eo3ds-rom-test-'));
    const romPath = path.join(tmpDir, 'bad.gba');
    fs.writeFileSync(romPath, Buffer.alloc(1024));

    await assert.rejects(() => validateRom(romPath), /16 MiB/);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
