const SAVE_BYTES = 128 * 1024;
const EMULATOR_FOOTER_BYTES = 512;
const SECTOR_BYTES = 0x1000;
const SECTOR_DATA_BYTES = 0xF80;
const SECTORS_PER_SLOT = 14;
const SECTOR_SIGNATURE = 0x08012025;
const SECTION_SIZES = [
  0xF2C,
  0xF80, 0xF80, 0xF80, 0xF08,
  0xF80, 0xF80, 0xF80, 0xF80, 0xF80, 0xF80, 0xF80, 0xF80, 0x7D0
];

function checksum(data, size) {
  let sum = 0;
  for (let offset = 0; offset < size; offset += 4) sum = (sum + data.readUInt32LE(offset)) >>> 0;
  return ((sum >>> 16) + (sum & 0xFFFF)) & 0xFFFF;
}

function inspectSlot(save, slot) {
  const sections = new Map();
  const counters = new Set();
  const errors = [];
  for (let index = 0; index < SECTORS_PER_SLOT; index += 1) {
    const offset = (slot * SECTORS_PER_SLOT + index) * SECTOR_BYTES;
    const data = save.subarray(offset, offset + SECTOR_DATA_BYTES);
    const id = save.readUInt16LE(offset + 0xFF4);
    const storedChecksum = save.readUInt16LE(offset + 0xFF6);
    const signature = save.readUInt32LE(offset + 0xFF8);
    const counter = save.readUInt32LE(offset + 0xFFC);
    if (id >= SECTORS_PER_SLOT) { errors.push(`sector ${index} has invalid section id`); continue; }
    if (signature !== SECTOR_SIGNATURE) { errors.push(`section ${id} has invalid signature`); continue; }
    if (storedChecksum !== checksum(data, SECTION_SIZES[id])) { errors.push(`section ${id} has invalid checksum`); continue; }
    if (sections.has(id)) { errors.push(`section ${id} is duplicated`); continue; }
    sections.set(id, data);
    counters.add(counter);
  }
  return {
    slot,
    valid: errors.length === 0 && sections.size === SECTORS_PER_SLOT && counters.size === 1,
    counter: counters.size === 1 ? [...counters][0] : null,
    sections,
    errors
  };
}

function newerSlot(left, right) {
  if (left.counter === 0 && right.counter === 0xFFFFFFFF) return left;
  if (right.counter === 0 && left.counter === 0xFFFFFFFF) return right;
  return left.counter >= right.counter ? left : right;
}

function encodeTrainerName(name) {
  if (typeof name !== 'string' || !/^[A-Z]{1,7}$/.test(name)) {
    throw new Error('test trainer name must contain 1-7 uppercase ASCII letters');
  }
  const encoded = Buffer.alloc(8, 0xFF);
  for (let index = 0; index < name.length; index += 1) encoded[index] = 0xBB + name.charCodeAt(index) - 0x41;
  return encoded;
}

export function rewriteEmeraldTrainerIdentity(value, { name, trainerId }) {
  if (!Buffer.isBuffer(value)) throw new Error('Emerald identity rewrite requires a Buffer');
  if (value.length !== SAVE_BYTES && value.length !== SAVE_BYTES + EMULATOR_FOOTER_BYTES) {
    throw new Error(`private Emerald save must be 131072 or 131584 bytes, received ${value.length}`);
  }
  if (!Number.isSafeInteger(trainerId) || trainerId < 0 || trainerId > 0xFFFFFFFF) {
    throw new Error('test trainer ID must be an unsigned 32-bit integer');
  }

  const rewritten = Buffer.from(value);
  const encodedName = encodeTrainerName(name);
  let rewrittenSections = 0;
  for (let slot = 0; slot < 2; slot += 1) {
    for (let sectorIndex = 0; sectorIndex < SECTORS_PER_SLOT; sectorIndex += 1) {
      const offset = (slot * SECTORS_PER_SLOT + sectorIndex) * SECTOR_BYTES;
      const id = rewritten.readUInt16LE(offset + 0xFF4);
      const signature = rewritten.readUInt32LE(offset + 0xFF8);
      if (id !== 0 || signature !== SECTOR_SIGNATURE) continue;
      const data = rewritten.subarray(offset, offset + SECTOR_DATA_BYTES);
      if (rewritten.readUInt16LE(offset + 0xFF6) !== checksum(data, SECTION_SIZES[0])) continue;
      encodedName.copy(rewritten, offset);
      rewritten.writeUInt32LE(trainerId, offset + 0x0A);
      rewritten.writeUInt16LE(checksum(data, SECTION_SIZES[0]), offset + 0xFF6);
      rewrittenSections += 1;
    }
  }
  if (!rewrittenSections) throw new Error('private Emerald save has no checksum-valid trainer section');
  inspectEmeraldSave(rewritten);
  return rewritten;
}

export function inspectEmeraldSave(value) {
  if (!Buffer.isBuffer(value)) throw new Error('Emerald save inspection requires a Buffer');
  if (value.length !== SAVE_BYTES && value.length !== SAVE_BYTES + EMULATOR_FOOTER_BYTES) {
    throw new Error(`private Emerald save must be 131072 or 131584 bytes, received ${value.length}`);
  }
  const save = value.subarray(0, SAVE_BYTES);
  const slots = [inspectSlot(save, 0), inspectSlot(save, 1)];
  const validSlots = slots.filter(slot => slot.valid);
  if (!validSlots.length) throw new Error('private Emerald save has no complete checksum-valid save slot');
  const active = validSlots.reduce(newerSlot);
  const block2 = active.sections.get(0);
  const block1 = Buffer.concat([1, 2, 3, 4].map(id => active.sections.get(id)));
  const playTimeHours = block2.readUInt16LE(0x0E);
  const playTimeMinutesRemainder = block2[0x10];
  const partyCount = block1[0x234];
  const mapGroup = block1.readInt8(0x04);
  const mapNumber = block1.readInt8(0x05);
  const x = block1.readInt16LE(0x00);
  const y = block1.readInt16LE(0x02);
  const progressed = partyCount >= 1 && partyCount <= 6 &&
    (playTimeHours > 0 || playTimeMinutesRemainder > 0) &&
    mapGroup >= 0 && mapNumber >= 0 && x >= 0 && y >= 0;
  return {
    validSlotCount: validSlots.length,
    activeSlot: active.slot + 1,
    saveCounter: active.counter,
    playTimeMinutes: playTimeHours * 60 + playTimeMinutesRemainder,
    partyCount,
    mapGroup,
    mapNumber,
    x,
    y,
    progressed
  };
}
