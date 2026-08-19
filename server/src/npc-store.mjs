export class PostgresNpcStore {
  constructor(pool) {
    if (!pool) throw new Error('PostgreSQL pool is required');
    this.pool = pool;
  }

  async listNpcsForMap(map) {
    const result = await this.pool.query(
      `SELECT slug, name, quest_id, x, y, facing, sprite, dialogue
       FROM npc_spawns
       WHERE map = $1 AND active = true`,
      [map]
    );
    return result.rows.map(row => ({
      slug: row.slug,
      name: row.name,
      quest_id: row.quest_id,
      x: row.x,
      y: row.y,
      facing: row.facing,
      sprite: row.sprite,
      dialogue: Array.isArray(row.dialogue) ? row.dialogue : []
    }));
  }

  async findNpcBySlug(slug) {
    const result = await this.pool.query(
      `SELECT slug, name, quest_id, x, y, facing, sprite, dialogue
       FROM npc_spawns
       WHERE slug = $1 AND active = true`,
      [slug]
    );
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return {
      slug: row.slug,
      name: row.name,
      quest_id: row.quest_id,
      x: row.x,
      y: row.y,
      facing: row.facing,
      sprite: row.sprite,
      dialogue: Array.isArray(row.dialogue) ? row.dialogue : []
    };
  }

  async auditNpcInteract(identityId, npcSlug, details = {}) {
    await this.pool.query(
      "INSERT INTO moderation_audit (actor_identity_id, action, details) VALUES ($1, 'npc_interact', $2)",
      [identityId, JSON.stringify({ npc_slug: npcSlug, ...details })]
    );
  }
}

export class MemoryNpcStore {
  constructor() {
    this.npcs = new Map([
      ['scientist-welcome', {
        slug: 'scientist-welcome',
        name: 'Scientist',
        quest_id: null, // populated by seed if available; tests can override
        x: 14,
        y: 13,
        facing: 'down',
        sprite: 'scientist',
        dialogue: ['Welcome to Emerald Online 3DS - Beta!', 'Would you like to join our research team?']
      }]
    ]);
    this.auditLog = [];
  }

  async listNpcsForMap(map) {
    // The memory store keeps a single test NPC on map '0-9'.
    return [...this.npcs.values()].filter(npc => map === '0-9' || npc.map === map);
  }

  async findNpcBySlug(slug) {
    return this.npcs.get(slug) ?? null;
  }

  async auditNpcInteract(identityId, npcSlug, details = {}) {
    this.auditLog.push({ actor_identity_id: identityId, action: 'npc_interact', details: { npc_slug: npcSlug, ...details }, created_at: Date.now() });
  }

  // Test helper: add or replace an NPC without a database.
  setNpc(slug, npc) {
    this.npcs.set(slug, { ...npc, slug });
  }
}
