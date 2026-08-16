import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOM = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const SAVE_BYTES = new Set([128 * 1024, 128 * 1024 + 512]);
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateRoom() {
  const bytes = crypto.randomBytes(8);
  const token = [...bytes].map(value => ALPHABET[value % ALPHABET.length]).join('');
  return `${token.slice(0, 4)}-${token.slice(4, 8)}`;
}

export function validateRoom(value) {
  const room = String(value ?? '').toUpperCase();
  if (!ROOM.test(room)) throw new Error('room must use the format ABCD-2345 without ambiguous characters');
  return room;
}

function requireFile(filename, label) {
  if (!fs.statSync(filename, { throwIfNoEntry: false })?.isFile()) throw new Error(`missing ${label}: ${filename}`);
}

function config({ name, room }) {
  return [
    'server=live.emeraldonline3ds.com',
    'port=443',
    'transport=wss',
    'path=/game',
    `name=${name}`,
    `link_room=${room}`,
    ''
  ].join('\n');
}

export function prepareLinkTest({ projectRoot, outputDirectory, room, savePath = null }) {
  const resolvedRoot = path.resolve(projectRoot);
  const validatedRoom = validateRoom(room);
  const output = path.resolve(outputDirectory);
  const generatedRoot = path.join(resolvedRoot, 'generated') + path.sep;
  if (!output.startsWith(generatedRoot)) throw new Error('link test output must stay under generated/');
  if (fs.existsSync(output)) throw new Error(`refusing to overwrite existing test bundle: ${output}`);

  const cia = path.join(resolvedRoot, 'release', 'emerald-online-3ds.cia');
  const threeDsx = path.join(resolvedRoot, 'release', 'emerald-online-3ds.3dsx');
  const rom = path.join(resolvedRoot, 'Pokemon - Emerald Version.gba');
  const avatar = path.join(resolvedRoot, 'generated', 'sd-card', '3ds', 'emerald-online-3ds', 'avatars.t3x');
  requireFile(cia, 'release CIA');
  requireFile(threeDsx, 'release 3DSX');
  requireFile(rom, 'private Emerald ROM');

  let resolvedSave = null;
  if (savePath) {
    resolvedSave = path.resolve(savePath);
    requireFile(resolvedSave, 'private Emerald save');
    const bytes = fs.statSync(resolvedSave).size;
    if (!SAVE_BYTES.has(bytes)) throw new Error(`private Emerald save must be 131072 or 131584 bytes, received ${bytes}`);
  }

  const physicalApp = path.join(output, 'physical-sd', '3ds', 'emerald-online-3ds');
  const physicalCias = path.join(output, 'physical-sd', 'cias');
  const emulatorApp = path.join(output, 'azahar-profile', 'data', 'azahar-emu', 'sdmc', '3ds', 'emerald-online-3ds');
  fs.mkdirSync(physicalApp, { recursive: true });
  fs.mkdirSync(physicalCias, { recursive: true });
  fs.mkdirSync(emulatorApp, { recursive: true });

  fs.copyFileSync(threeDsx, path.join(physicalApp, 'emerald-online-3ds.3dsx'));
  fs.copyFileSync(cia, path.join(physicalCias, 'emerald-online-3ds.cia'));
  fs.writeFileSync(path.join(physicalApp, 'online.cfg'), config({ name: 'Physical', room: validatedRoom }), { mode: 0o600 });

  fs.copyFileSync(rom, path.join(emulatorApp, 'emerald.gba'));
  fs.writeFileSync(path.join(emulatorApp, 'online.cfg'), config({ name: 'Azahar', room: validatedRoom }), { mode: 0o600 });
  if (fs.existsSync(avatar)) fs.copyFileSync(avatar, path.join(emulatorApp, 'avatars.t3x'));
  if (resolvedSave) fs.copyFileSync(resolvedSave, path.join(emulatorApp, 'emerald.sav'));

  const manifest = {
    room: validatedRoom,
    createdAt: new Date().toISOString(),
    release: JSON.parse(fs.readFileSync(path.join(resolvedRoot, 'package.json'), 'utf8')).version,
    ciaSha256: crypto.createHash('sha256').update(fs.readFileSync(cia)).digest('hex'),
    threeDsxSha256: crypto.createHash('sha256').update(fs.readFileSync(threeDsx)).digest('hex'),
    emulatorSaveIncluded: Boolean(resolvedSave),
    privateFilesExcludedFromPhysicalBundle: ['emerald.gba', 'emerald.sav', 'identity.cfg', 'stats.cfg', 'avatars.t3x']
  };
  fs.writeFileSync(path.join(output, 'test-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return { output, physicalSd: path.join(output, 'physical-sd'), azaharProfile: path.join(output, 'azahar-profile'), ...manifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const projectRoot = path.resolve(import.meta.dirname, '..');
  let room = generateRoom();
  let savePath = null;
  let outputDirectory = null;
  for (let index = 2; index < process.argv.length; ++index) {
    const argument = process.argv[index];
    if (argument === '--room') room = process.argv[++index];
    else if (argument === '--save') savePath = process.argv[++index];
    else if (argument === '--output') outputDirectory = process.argv[++index];
    else throw new Error(`unknown argument: ${argument}`);
  }
  room = validateRoom(room);
  outputDirectory ??= path.join(projectRoot, 'generated', `link-test-${room.toLowerCase()}`);
  console.log(JSON.stringify(prepareLinkTest({ projectRoot, outputDirectory, room, savePath }), null, 2));
}
