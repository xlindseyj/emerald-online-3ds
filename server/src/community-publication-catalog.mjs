import crypto from 'node:crypto';

const KEY = /^[a-z0-9][a-z0-9-]{2,79}$/;
const CATEGORIES = new Set([
  'announcements', 'installation-help', 'service-status', 'beta-testing',
  'development-code', 'feature-ideas', 'multiplayer-help', 'general'
]);
const KINDS = new Set(['guide', 'status', 'welcome']);

function text(value, name, maximum) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum) throw new Error(`invalid community publication ${name}`);
  return value.trim();
}

export function validateCommunityPublicationCatalog(value) {
  if (!Array.isArray(value) || !value.length || value.length > 30) throw new Error('community publication catalog must contain 1-30 entries');
  const keys = new Set();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || !KEY.test(entry.key ?? '') || keys.has(entry.key)) throw new Error(`invalid or duplicate community publication key at index ${index}`);
    if (!KINDS.has(entry.kind) || !CATEGORIES.has(entry.category)) throw new Error(`invalid community publication route for ${entry.key}`);
    if (typeof entry.pinned !== 'boolean' || typeof entry.locked !== 'boolean') throw new Error(`invalid community publication flags for ${entry.key}`);
    keys.add(entry.key);
    return {
      key: entry.key,
      kind: entry.kind,
      category: entry.category,
      title: text(entry.title, 'title', 120),
      body: text(entry.body, 'body', 10000),
      pinned: entry.pinned,
      locked: entry.locked
    };
  });
}

export function communityPublicationContentHash(publication) {
  return crypto.createHash('sha256').update(JSON.stringify(publication)).digest('hex');
}
