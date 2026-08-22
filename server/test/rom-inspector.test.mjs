import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectRom } from '../../tools/inspect-rom.mjs';

test('rejects a non-ROM-sized input', () => {
  assert.throws(() => inspectRom(Buffer.alloc(100)), /16 MiB/);
});

test('validates the header but rejects an unknown BPEE revision hash', () => {
  const rom = Buffer.alloc(16 * 1024 * 1024); rom.write('POKEMON EMER', 0xA0, 'ascii'); rom.write('BPEE', 0xAC, 'ascii'); rom.write('01', 0xB0, 'ascii');
  rom[0xB2] = 0x96; let sum = 0; for (let i = 0xA0; i <= 0xBC; i++) sum = (sum - rom[i]) & 0xff; rom[0xBD] = (sum - 0x19) & 0xff;
  const info = inspectRom(rom);
  assert.equal(info.headerChecksumValid, true);
  assert.equal(info.identityValid, true);
  assert.equal(info.supported, false);
});
