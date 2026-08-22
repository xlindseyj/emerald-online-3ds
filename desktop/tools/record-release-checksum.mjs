import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageInfo = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'));
const installerInput = path.resolve(process.argv[2] ?? '');
const installerPath = fs.statSync(installerInput, { throwIfNoEntry: false })?.isDirectory()
  ? path.join(installerInput, `EmeraldOnline3DS-Setup-${packageInfo.version}.exe`)
  : installerInput;
const checksumsPath = path.resolve(process.argv[3] ?? '');
if (!process.argv[2] || !process.argv[3]) {
  throw new Error('usage: node record-release-checksum.mjs <installer.exe-or-directory> <SHA256SUMS>');
}
if (!fs.statSync(installerPath, { throwIfNoEntry: false })?.isFile()) throw new Error(`installer missing: ${installerPath}`);
if (!fs.statSync(checksumsPath, { throwIfNoEntry: false })?.isFile()) throw new Error(`checksum manifest missing: ${checksumsPath}`);

const filename = path.basename(installerPath);
const digest = crypto.createHash('sha256').update(fs.readFileSync(installerPath)).digest('hex');
const retained = fs.readFileSync(checksumsPath, 'utf8')
  .split('\n')
  .filter(line => line.trim() && !line.trim().endsWith(`  ${filename}`));
retained.push(`${digest}  ${filename}`);
fs.writeFileSync(checksumsPath, `${retained.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, filename, sha256: digest }));
