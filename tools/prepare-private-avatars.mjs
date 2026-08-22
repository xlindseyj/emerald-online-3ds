import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PNG } from 'pngjs';
import { SUPPORTED_EMERALD_SHA256 } from './inspect-rom.mjs';

const root = path.resolve(import.meta.dirname, '..');
const romPath = path.resolve(process.argv[2] ?? path.join(root, 'Pokemon - Emerald Version.gba'));
const output = path.resolve(process.argv[3] ?? path.join(root, 'generated', 'private-avatar-build'));
const rom = fs.readFileSync(romPath);
fs.mkdirSync(output, { recursive: true });
const romSha256 = crypto.createHash('sha256').update(rom).digest('hex');
if (romSha256 !== SUPPORTED_EMERALD_SHA256) throw new Error(`unsupported Emerald revision: ${romSha256}`);

function decodeFrame(graphics, paletteData, frame) {
  const image = new PNG({ width: 16, height: 32 });
  const colors = Array.from({ length: 16 }, (_, index) => {
    const color = paletteData.readUInt16LE(index * 2);
    return [(color & 31) * 255 / 31, ((color >> 5) & 31) * 255 / 31, ((color >> 10) & 31) * 255 / 31, index ? 255 : 0];
  });
  let cursor = frame * 256;
  for (let tileY = 0; tileY < 4; ++tileY)
    for (let tileX = 0; tileX < 2; ++tileX)
      for (let y = 0; y < 8; ++y)
        for (let x = 0; x < 8; x += 2) {
          const packed = graphics[cursor++];
          for (let half = 0; half < 2; ++half) {
            const color = colors[(packed >> (half * 4)) & 15];
            const px = tileX * 8 + x + half;
            const py = tileY * 8 + y;
            const destination = (py * 16 + px) * 4;
            for (let component = 0; component < 4; ++component) image.data[destination + component] = Math.round(color[component]);
          }
        }
  return image;
}

// Exact offsets for the allowlisted US Emerald revision. Keeping these
// structural offsets avoids requiring copyrighted reference graphics in the
// source checkout; all extracted pixels stay in the ignored private build.
const sources = [
  ['b', 'brendan', 0x4975F8, 0x4987F8],
  ['g', 'may', 0x4A3078, 0x4A4278],
];
const locations = [];
for (const [prefix, name, graphicsOffset, paletteOffset] of sources) {
  const graphics = rom.subarray(graphicsOffset, graphicsOffset + 2304);
  const palette = rom.subarray(paletteOffset, paletteOffset + 32);
  if (graphics.length !== 2304 || palette.length !== 32 || palette.every(value => value === 0)) throw new Error(`invalid ${name} avatar data`);
  locations.push({ name, graphicsOffset, paletteOffset });
  for (let frame = 0; frame < 9; ++frame)
    fs.writeFileSync(path.join(output, `${prefix}${String(frame).padStart(2, '0')}.png`), PNG.sync.write(decodeFrame(graphics, palette, frame)));
}

const frameNames = ['b', 'g'].flatMap(prefix => Array.from({ length: 9 }, (_, frame) => `${prefix}${String(frame).padStart(2, '0')}.png`));
fs.writeFileSync(path.join(output, 'avatars.t3s'), `--atlas -f rgba5551 -z auto\n${frameNames.join('\n')}\n`);
console.log(JSON.stringify({ ok: true, romPath, output, frames: 18, extractedFromRom: true, locations }));
