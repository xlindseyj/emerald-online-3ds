export const VERSION = 2;
export const LEGACY_VERSION = 1;
export const MAX_LINE = 4096;
const NAME = /^[\x20-!#-\[\]-~]{1,12}$/;
const MAP = /^[a-z0-9_-]{1,32}$/;
const FACINGS = new Set(['up', 'down', 'left', 'right']);
const CHAT = /^[\x20-!#-\[\]-~]{1,80}$/;
const CHAT_SCOPES = new Set(['map', 'global']);
const EMOTES = new Set(['wave', 'battle', 'trade', 'gg']);
const SESSION = /^[a-f0-9]{32}$/i;
const IDENTITY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN = /^[a-f0-9]{64}$/i;
const RECOVERY = /^[A-Z2-9]{4}(?:-[A-Z2-9]{4}){4}$/;
const PAIRING = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const AVATARS = new Set(['boy', 'girl']);
const STAT_FIELDS = new Set(['pokedex_seen', 'pokedex_caught', 'badges', 'frontier_streaks']);
const LINK_ROOM = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const LINK_CORE = 'gpSP v1.0';
const LINK_DATA = /^(?:[a-f0-9]{2}){1,512}$/i;
const DESTINATION_ID = /^[a-z][a-z0-9_-]*:[A-Za-z0-9_-]{1,64}$|^mom$/;
const NPC_ID = /^[a-z0-9_-]{1,64}$/;
const RESOURCE_NODE_ID = /^[a-z0-9_-]{1,64}$/;
const FINGERPRINT = /^[A-F0-9]{10}$/;
const TITLE = /^[\x20-!#-\[\]-~]{1,40}$/;
const GUILD_NAME = /^[\x20-!#-\[\]-~]{1,40}$/;
const GUILD_TAG = /^[A-Z0-9]{2,6}$/;
const NPC_INTERACT_DISTANCE = 2;

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

export function validateLinkJoin(msg) {
  return msg?.type === 'link_spike_join' && LINK_ROOM.test(msg.room ?? '') && msg.core === LINK_CORE;
}

export function validateLinkPacket(msg) {
  return msg?.type === 'link_packet' && Number.isInteger(msg.to) &&
    (msg.to === 0xffff || (msg.to >= 0 && msg.to <= 3)) && LINK_DATA.test(msg.data ?? '');
}

export function validateState(msg, previousSeq = -1) {
  return msg?.type === 'state' && Number.isSafeInteger(msg.seq) && msg.seq > previousSeq &&
    MAP.test(msg.map) && Number.isInteger(msg.x) && msg.x >= 0 && msg.x <= 4095 &&
    Number.isInteger(msg.y) && msg.y >= 0 && msg.y <= 4095 && FACINGS.has(msg.facing) &&
    (msg.avatar === undefined || AVATARS.has(msg.avatar));
}

export function validateChat(msg) {
	return msg?.type === 'chat' && typeof msg.text === 'string' && CHAT.test(msg.text) &&
		(msg.scope === undefined || CHAT_SCOPES.has(msg.scope));
}

export function validateEmote(msg) {
	return msg?.type === 'emote' && EMOTES.has(msg.emote);
}

export function validateTeleportLocations(msg) {
  return msg?.type === 'teleport_locations';
}

export function validateTeleport(msg) {
  return msg?.type === 'teleport' && DESTINATION_ID.test(msg.destination_id ?? '');
}

export function validateNpcInteract(msg) {
  return msg?.type === 'npc_interact' && NPC_ID.test(msg.npc_id ?? '');
}

export function validateQuestAccept(msg) {
  return msg?.type === 'quest_accept' && IDENTITY.test(msg.quest_id ?? '');
}

export function validateQuestClaim(msg) {
  return msg?.type === 'quest_claim' && IDENTITY.test(msg.quest_id ?? '');
}

export function validateResourceInteract(msg) {
  return msg?.type === 'resource_interact' && RESOURCE_NODE_ID.test(msg.node_id ?? '');
}

export function validateQuestList(msg) {
  return msg?.type === 'quest_list';
}

export function validateTitleList(msg) {
  return msg?.type === 'title_list';
}

export function validateTitleEquip(msg) {
  return msg?.type === 'title_equip' && TITLE.test(msg.title ?? '');
}

export function validateFriendRequest(msg) {
  return msg?.type === 'friend_request' && FINGERPRINT.test(msg.fingerprint ?? '');
}

export function validateFriendAccept(msg) {
  return msg?.type === 'friend_accept' && FINGERPRINT.test(msg.fingerprint ?? '');
}

export function validateFriendRemove(msg) {
  return msg?.type === 'friend_remove' && FINGERPRINT.test(msg.fingerprint ?? '');
}

export function validateFriendList(msg) {
  return msg?.type === 'friend_list';
}

export function validateGuildCreate(msg) {
  return msg?.type === 'guild_create' && GUILD_NAME.test(msg.name ?? '') && GUILD_TAG.test(msg.tag ?? '');
}

export function validateGuildJoin(msg) {
  return msg?.type === 'guild_join' && GUILD_NAME.test(msg.name ?? '');
}

export function validateGuildLeave(msg) {
  return msg?.type === 'guild_leave';
}

export function validateGuildDisband(msg) {
  return msg?.type === 'guild_disband';
}

export function validateGuildKick(msg) {
  return msg?.type === 'guild_kick' && FINGERPRINT.test(msg.fingerprint ?? '');
}

export function validateGuildInfo(msg) {
  return msg?.type === 'guild_info';
}

export function npcInteractDistance(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

export function encode(msg) { return `${JSON.stringify(msg)}\n`; }
