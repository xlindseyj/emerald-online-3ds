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
