export const VERSION = 1;
export const MAX_LINE = 4096;
const NAME = /^[\x20-!#-\[\]-~]{1,12}$/;
const MAP = /^[a-z0-9_-]{1,32}$/;
const FACINGS = new Set(['up', 'down', 'left', 'right']);
const CHAT = /^[\x20-!#-\[\]-~]{1,80}$/;
const EMOTES = new Set(['wave', 'battle', 'trade', 'gg']);
const SESSION = /^[a-f0-9]{32}$/i;
const AVATARS = new Set(['boy', 'girl']);

export function validateHello(msg) {
  return msg?.type === 'hello' && msg.version === VERSION && NAME.test(msg.name) &&
    (msg.session === undefined || SESSION.test(msg.session)) &&
    (msg.avatar === undefined || AVATARS.has(msg.avatar));
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
