import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [sourcePath, outputPath] = process.argv.slice(2).map(filename => path.resolve(filename));
if (!sourcePath || !outputPath) throw new Error('usage: node tools/prepare-cia-assets.mjs <upstream-rsf> <output-rsf>');

const expectedSha256 = '1a48e0df4089ac12040fd6e0591f130422e686877072c5375227802f3fb59ced';
const source = fs.readFileSync(sourcePath);
const actualSha256 = crypto.createHash('sha256').update(source).digest('hex');
if (actualSha256 !== expectedSha256) throw new Error(`unexpected upstream CIA template hash: ${actualSha256}`);

let rsf = source.toString('utf8');
const replacements = [
  [/Title\s+: "\$\{PROJECT_NAME\}"/, 'Title                   : "Emerald Online 3DS"'],
  [/ProductCode\s+: "CTR-P-MGBA"/, 'ProductCode             : "CTR-P-EO3D"'],
  [/UniqueId\s+: 0x1A1E/, 'UniqueId                : 0xE03D'],
  [/DisableDebug\s+: true/, 'DisableDebug                  : false'],
  [/CanWriteSharedPage\s+: false/, 'CanWriteSharedPage            : true'],
  [/CanUseNonAlphabetAndNumber\s+: false/, 'CanUseNonAlphabetAndNumber    : true'],
  [/CanShareDeviceMemory\s+: false/, 'CanShareDeviceMemory          : true'],
  [/SpecialMemoryArrange\s+: false/, 'SpecialMemoryArrange          : true'],
  [/ControlProcessMemory:\s+112/, 'Backdoor: 123'],
];
for (const [pattern, replacement] of replacements) {
  if (!pattern.test(rsf)) throw new Error(`CIA template no longer matches ${pattern}`);
  rsf = rsf.replace(pattern, replacement);
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, rsf);
console.log(JSON.stringify({ ok: true, sourceSha256: actualSha256, outputPath }));
