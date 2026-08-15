import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const SUPPORTED_EMERALD_SHA256 = 'a9dec84dfe7f62ab2220bafaef7479da0929d066ece16a6885f6226db19085af';

export function inspectRom(buffer) {
  if (buffer.length !== 16 * 1024 * 1024) throw new Error(`expected a 16 MiB GBA ROM, got ${buffer.length} bytes`);
  const ascii = (start, end) => buffer.subarray(start, end).toString('ascii').replace(/\0+$/g, '').trimEnd();
  let checksum = 0; for (let i = 0xA0; i <= 0xBC; i++) checksum = (checksum - buffer[i]) & 0xff;
  checksum = (checksum - 0x19) & 0xff;
  const info = {
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    title: ascii(0xA0, 0xAC), gameCode: ascii(0xAC, 0xB0), makerCode: ascii(0xB0, 0xB2),
    version: buffer[0xBC], headerChecksum: buffer[0xBD], headerChecksumValid: checksum === buffer[0xBD]
  };
  info.identityValid = info.gameCode === 'BPEE' && info.makerCode === '01' && info.version === 0 && info.headerChecksumValid;
  info.supported = info.identityValid && info.sha256 === SUPPORTED_EMERALD_SHA256;
  return info;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const filename = process.argv[2]; if (!filename) { console.error('usage: node tools/inspect-rom.mjs <private-rom.gba>'); process.exit(2); }
  const info = inspectRom(fs.readFileSync(filename)); console.log(JSON.stringify(info, null, 2));
  if (!info.supported) process.exitCode = 1;
}
