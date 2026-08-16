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
