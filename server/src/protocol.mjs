export const VERSION = 2;
export const LEGACY_VERSION = 1;
export const MAX_LINE = 4096;
const NAME = /^[\x20-!#-\[\]-~]{1,12}$/;
const MAP = /^[a-z0-9_-]{1,32}$/;
const FACINGS = new Set(['up', 'down', 'left', 'right']);
const CHAT = /^[\x20-!#-\[\]-~]{1,80}$/;
const EMOTES = new Set(['wave', 'battle', 'trade', 'gg']);
const SESSION = /^[a-f0-9]{32}$/i;
const IDENTITY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[a-f0-9]{64}$/i;
const RECOVERY = /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){4}$/;
const PAIRING = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const AVATARS = new Set(['boy', 'girl']);
const STAT_FIELDS = new Set(['pokedex_seen', 'pokedex_caught', 'badges', 'frontier_streaks']);

export function validateHello(msg) {
  if (msg?.type !== 'hello' || !NAME.test(msg.name) || (msg.avatar !== undefined && !AVATARS.has(msg.avatar))) return false;
  if (msg.version === LEGACY_VERSION) return msg.session === undefined || SESSION.test(msg.session);
  return msg.version === VERSION && IDENTITY.test(msg.identity ?? '') && TOKEN.test(msg.token ?? '');
}

export function validateEnroll(msg) {
  return msg?.type === 'enroll' && msg.version === VERSION && NAME.test(msg.name) &&
    (msg.avatar === undefined || AVATARS.has(msg.avatar)) &&
    (msg.recovery === undefined || typeof msg.recovery === 'boolean');
}

export function validateRecover(msg) {
  return msg?.type === 'recover_identity' && msg.version === VERSION && NAME.test(msg.name) &&
    IDENTITY.test(msg.identity ?? '') && RECOVERY.test(msg.recoveryCode ?? '') &&
    (msg.avatar === undefined || AVATARS.has(msg.avatar));
}

export function validatePairBrowserApprove(msg) {
  return msg?.type === 'pair_browser_approve' && PAIRING.test(msg.code ?? '');
}

export function validateStatsConsent(msg) {
  if (msg?.type !== 'stats_consent' || typeof msg.enabled !== 'boolean' ||
      (msg.deleteHistory !== undefined && typeof msg.deleteHistory !== 'boolean') ||
      !msg.fields || typeof msg.fields !== 'object' || Array.isArray(msg.fields)) return false;
  const keys = Object.keys(msg.fields);
  return keys.length === STAT_FIELDS.size && keys.every(key => STAT_FIELDS.has(key) && typeof msg.fields[key] === 'boolean');
}

export function validateStatsSnapshot(msg) {
  if (msg?.type !== 'stats_snapshot' || !/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-z0-9.-]+)?$/i.test(msg.release ?? '') ||
      !msg.values || typeof msg.values !== 'object' || Array.isArray(msg.values)) return false;
  const keys = Object.keys(msg.values);
  if (!keys.length || keys.some(key => !STAT_FIELDS.has(key))) return false;
  const bounded = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;
  if ('pokedex_seen' in msg.values && !bounded(msg.values.pokedex_seen, 386)) return false;
  if ('pokedex_caught' in msg.values && !bounded(msg.values.pokedex_caught, 386)) return false;
  if ('badges' in msg.values && !bounded(msg.values.badges, 8)) return false;
  if ('pokedex_seen' in msg.values && 'pokedex_caught' in msg.values && msg.values.pokedex_caught > msg.values.pokedex_seen) return false;
  if ('frontier_streaks' in msg.values) {
    if (!Array.isArray(msg.values.frontier_streaks) || msg.values.frontier_streaks.length > 24) return false;
    const facilities = new Set(['tower','dome','palace','arena','factory','pike','pyramid']);
    const seen = new Set();
    for (const row of msg.values.frontier_streaks) {
      if (!row || !facilities.has(row.facility) || !['singles','doubles'].includes(row.mode) || !['50','open'].includes(row.level) || !bounded(row.streak,9999)) return false;
      if (['arena','pike','pyramid'].includes(row.facility) && row.mode !== 'singles') return false;
      const key = `${row.facility}:${row.mode}:${row.level}`; if (seen.has(key)) return false; seen.add(key);
    }
  }
  return true;
}

export function validateState(msg, previousSeq = -1) {
  return msg?.type === 'state' && Number.isSafeInteger(msg.seq) && msg.seq > previousSeq &&
    MAP.test(msg.map) && Number.isInteger(msg.x) && msg.x >= 0 && msg.x <= 4095 &&
    Number.isInteger(msg.y) && msg.y >= 0 && msg.y <= 4095 && FACINGS.has(msg.facing) &&
    (msg.avatar === undefined || AVATARS.has(msg.avatar));
}

export function validateChat(msg) {
	return msg?.type === 'chat' && typeof msg.text === 'string' && CHAT.test(msg.text);
}

export function validateEmote(msg) {
	return msg?.type === 'emote' && EMOTES.has(msg.emote);
}

export function encode(msg) { return `${JSON.stringify(msg)}\n`; }
