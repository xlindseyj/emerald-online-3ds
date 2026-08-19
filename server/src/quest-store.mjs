function isPrerequisite(kind) {
  return kind === 'quest_completed' || kind === 'stat_at_least';
}

async function meetsRequirements(progress, requirements, identityId, store) {
  if (!Array.isArray(requirements) || requirements.length === 0) return true;
  for (const req of requirements) {
    if (req.kind === 'talk_to_npc') {
      if (!progress?.npcs?.includes(req.npc_id)) return false;
    } else if (req.kind === 'stat_at_least') {
      const value = progress?.stats?.[req.stat] ?? 0;
      if (value < req.value) return false;
    } else if (req.kind === 'interact_resource') {
      if (!progress?.resources?.includes(req.node_id)) return false;
    } else if (req.kind === 'quest_completed') {
      const other = await store.getProgress(identityId, req.quest_id);
      if (!other || (other.status !== 'completed' && other.status !== 'claimed')) return false;
    }
  }
  return true;
}

function applyProgress(progress, action) {
  const next = { ...progress };
  if (action.kind === 'talk_to_npc') {
    next.npcs = Array.from(new Set([...(next.npcs ?? []), action.npc_id]));
  } else if (action.kind === 'interact_resource') {
    next.resources = Array.from(new Set([...(next.resources ?? []), action.node_id]));
  }
  return next;
}

export class PostgresQuestStore {
  constructor(pool, titleStore = null) {
    if (!pool) throw new Error('PostgreSQL pool is required');
    this.pool = pool;
    this.titleStore = titleStore;
  }

  async findQuestById(questId) {
    const result = await this.pool.query(
      `SELECT id, slug, title, description, requirements, reward_kind, reward_data, active
       FROM quests WHERE id = $1`,
      [questId]
    );
    return result.rows[0] ?? null;
  }

  async findQuestBySlug(slug) {
    const result = await this.pool.query(
      `SELECT id, slug, title, description, requirements, reward_kind, reward_data, active
       FROM quests WHERE slug = $1`,
      [slug]
    );
    return result.rows[0] ?? null;
  }

  async getProgress(identityId, questId) {
    const result = await this.pool.query(
      `SELECT quest_id, status, progress, created_at, updated_at
       FROM player_quest_progress
       WHERE identity_id = $1 AND quest_id = $2`,
      [identityId, questId]
    );
    return result.rows[0] ?? null;
  }

  async acceptQuest(identityId, questId) {
    const quest = await this.findQuestById(questId);
    if (!quest || !quest.active) return { error: 'quest_unavailable' };

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const existing = await client.query(
        `SELECT quest_id, status, progress FROM player_quest_progress
         WHERE identity_id = $1 AND quest_id = $2 FOR UPDATE`,
        [identityId, questId]
      );
      if (existing.rowCount) {
        await client.query('COMMIT');
        return { progress: existing.rows[0], quest };
      }
      const prerequisites = quest.requirements.filter(r => isPrerequisite(r.kind));
      if (!await meetsRequirements({}, prerequisites, identityId, this)) {
        await client.query('ROLLBACK');
        return { error: 'requirements_not_met' };
      }
      const autoComplete = quest.requirements.length === 0;
      const progress = {};
      const status = autoComplete ? 'completed' : 'accepted';
      await client.query(
        `INSERT INTO player_quest_progress (identity_id, quest_id, status, progress)
         VALUES ($1, $2, $3, $4)`,
        [identityId, questId, status, JSON.stringify(progress)]
      );
      await client.query('COMMIT');
      const row = { quest_id: questId, status, progress };
      if (autoComplete) {
        const claimed = await this.claimReward(identityId, questId);
        return { progress: { ...row, status: 'claimed', ...claimed }, quest, reward: claimed.reward };
      }
      return { progress: row, quest };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async completeQuest(identityId, questId) {
    const result = await this.pool.query(
      `UPDATE player_quest_progress
       SET status = 'completed', updated_at = now()
       WHERE identity_id = $1 AND quest_id = $2 AND status = 'accepted'
       RETURNING quest_id, status, progress`,
      [identityId, questId]
    );
    return result.rows[0] ?? null;
  }

  async recordResourceInteraction(identityId, nodeId) {
    const accepted = await this.pool.query(
      `SELECT quest_id, progress FROM player_quest_progress
       WHERE identity_id = $1 AND status = 'accepted'`,
      [identityId]
    );
    const completed = [];
    for (const row of accepted.rows) {
      const quest = await this.findQuestById(row.quest_id);
      if (!quest) continue;
      const needsNode = quest.requirements.some(r => r.kind === 'interact_resource' && r.node_id === nodeId);
      if (!needsNode) continue;
      const progress = typeof row.progress === 'string' ? JSON.parse(row.progress) : (row.progress ?? {});
      const nextProgress = applyProgress(progress, { kind: 'interact_resource', node_id: nodeId });
      const done = await meetsRequirements(nextProgress, quest.requirements, identityId, this);
      const status = done ? 'completed' : 'accepted';
      const updated = await this.pool.query(
        `UPDATE player_quest_progress
         SET progress = $1, status = $2, updated_at = now()
         WHERE identity_id = $3 AND quest_id = $4 AND status = 'accepted'
         RETURNING quest_id, status, progress`,
        [JSON.stringify(nextProgress), status, identityId, row.quest_id]
      );
      if (updated.rowCount) completed.push(updated.rows[0]);
    }
    return completed;
  }

  async recordNpcInteraction(identityId, npcId) {
    const accepted = await this.pool.query(
      `SELECT quest_id, progress FROM player_quest_progress
       WHERE identity_id = $1 AND status = 'accepted'`,
      [identityId]
    );
    const completed = [];
    for (const row of accepted.rows) {
      const quest = await this.findQuestById(row.quest_id);
      if (!quest) continue;
      const needsNpc = quest.requirements.some(r => r.kind === 'talk_to_npc' && r.npc_id === npcId);
      if (!needsNpc) continue;
      const progress = typeof row.progress === 'string' ? JSON.parse(row.progress) : (row.progress ?? {});
      const nextProgress = applyProgress(progress, { kind: 'talk_to_npc', npc_id: npcId });
      const done = await meetsRequirements(nextProgress, quest.requirements, identityId, this);
      const status = done ? 'completed' : 'accepted';
      const updated = await this.pool.query(
        `UPDATE player_quest_progress
         SET progress = $1, status = $2, updated_at = now()
         WHERE identity_id = $3 AND quest_id = $4 AND status = 'accepted'
         RETURNING quest_id, status, progress`,
        [JSON.stringify(nextProgress), status, identityId, row.quest_id]
      );
      if (updated.rowCount) completed.push(updated.rows[0]);
    }
    return completed;
  }

  async claimReward(identityId, questId) {
    const quest = await this.findQuestById(questId);
    if (!quest) return { error: 'quest_not_found' };
    const progress = await this.getProgress(identityId, questId);
    if (!progress || progress.status !== 'completed') return { error: 'quest_not_completed' };

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const updated = await client.query(
        `UPDATE player_quest_progress
         SET status = 'claimed', reward_claimed_at = now(), updated_at = now()
         WHERE identity_id = $1 AND quest_id = $2 AND status = 'completed'
         RETURNING quest_id, status, progress`,
        [identityId, questId]
      );
      if (!updated.rowCount) { await client.query('ROLLBACK'); return { error: 'quest_not_completed' }; }
      const reward = { kind: quest.reward_kind, data: quest.reward_data };
      if (quest.reward_kind === 'title' && quest.reward_data?.title) {
        if (this.titleStore) {
          await this.titleStore.unlockTitle(identityId, quest.reward_data.title, client);
          await this.titleStore.equipTitle(identityId, quest.reward_data.title, client);
        } else {
          await client.query(
            `INSERT INTO player_titles (identity_id, title, unlocked_at)
             VALUES ($1, $2, now())
             ON CONFLICT (identity_id, title) DO NOTHING`,
            [identityId, quest.reward_data.title]
          );
          await client.query(
            `INSERT INTO identity_titles (identity_id, title, updated_at)
             VALUES ($1, $2, now())
             ON CONFLICT (identity_id) DO UPDATE SET title = EXCLUDED.title, updated_at = now()`,
            [identityId, quest.reward_data.title]
          );
        }
      }
      await client.query('COMMIT');
      return { progress: updated.rows[0], reward };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listQuestsForIdentity(identityId) {
    const result = await this.pool.query(
      `SELECT q.id, q.slug, q.title, q.description, q.requirements, q.reward_kind, q.reward_data,
              COALESCE(p.status, 'available') AS status, p.progress
       FROM quests q
       LEFT JOIN player_quest_progress p ON p.quest_id = q.id AND p.identity_id = $1
       WHERE q.active = true AND (q.starts_at IS NULL OR q.starts_at <= now())
         AND (q.ends_at IS NULL OR q.ends_at > now())
       ORDER BY q.created_at ASC`,
      [identityId]
    );
    return result.rows;
  }

  async getEquippedTitle(identityId) {
    const result = await this.pool.query(
      'SELECT title FROM identity_titles WHERE identity_id = $1',
      [identityId]
    );
    return result.rows[0]?.title ?? null;
  }
}

export class MemoryQuestStore {
  constructor(titleStore = null) {
    this.quests = new Map();
    this.progress = new Map(); // key: `${identityId}:${questId}`
    this.titles = new Map();
    this.titleStore = titleStore;
  }

  _key(identityId, questId) { return `${identityId}:${questId}`; }

  async findQuestById(questId) { return this.quests.get(questId) ?? null; }
  async findQuestBySlug(slug) { return [...this.quests.values()].find(q => q.slug === slug) ?? null; }

  async getProgress(identityId, questId) {
    return this.progress.get(this._key(identityId, questId)) ?? null;
  }

  async acceptQuest(identityId, questId) {
    const quest = await this.findQuestById(questId);
    if (!quest || !quest.active) return { error: 'quest_unavailable' };
    const key = this._key(identityId, questId);
    if (this.progress.has(key)) return { progress: this.progress.get(key), quest };
    const prerequisites = quest.requirements.filter(r => isPrerequisite(r.kind));
    if (!await meetsRequirements({}, prerequisites, identityId, this)) return { error: 'requirements_not_met' };
    const autoComplete = quest.requirements.length === 0;
    const progress = {};
    const status = autoComplete ? 'completed' : 'accepted';
    const row = { quest_id: questId, status, progress, created_at: Date.now(), updated_at: Date.now() };
    this.progress.set(key, row);
    if (autoComplete) {
      const claimed = await this.claimReward(identityId, questId);
      return { progress: { ...row, status: 'claimed', ...claimed }, quest, reward: claimed.reward };
    }
    return { progress: row, quest };
  }

  async completeQuest(identityId, questId) {
    const key = this._key(identityId, questId);
    const row = this.progress.get(key);
    if (!row || row.status !== 'accepted') return null;
    row.status = 'completed';
    row.updated_at = Date.now();
    return row;
  }

  async recordResourceInteraction(identityId, nodeId) {
    const completed = [];
    for (const [key, row] of this.progress.entries()) {
      if (!key.startsWith(`${identityId}:`) || row.status !== 'accepted') continue;
      const quest = await this.findQuestById(row.quest_id);
      if (!quest) continue;
      const needsNode = quest.requirements.some(r => r.kind === 'interact_resource' && r.node_id === nodeId);
      if (!needsNode) continue;
      const nextProgress = applyProgress(row.progress, { kind: 'interact_resource', node_id: nodeId });
      const done = await meetsRequirements(nextProgress, quest.requirements, identityId, this);
      row.progress = nextProgress;
      row.status = done ? 'completed' : 'accepted';
      row.updated_at = Date.now();
      completed.push({ quest_id: row.quest_id, status: row.status, progress: row.progress });
    }
    return completed;
  }

  async recordNpcInteraction(identityId, npcId) {
    const completed = [];
    for (const [key, row] of this.progress.entries()) {
      if (!key.startsWith(`${identityId}:`) || row.status !== 'accepted') continue;
      const quest = await this.findQuestById(row.quest_id);
      if (!quest) continue;
      const needsNpc = quest.requirements.some(r => r.kind === 'talk_to_npc' && r.npc_id === npcId);
      if (!needsNpc) continue;
      const nextProgress = applyProgress(row.progress, { kind: 'talk_to_npc', npc_id: npcId });
      const done = await meetsRequirements(nextProgress, quest.requirements, identityId, this);
      row.progress = nextProgress;
      row.status = done ? 'completed' : 'accepted';
      row.updated_at = Date.now();
      completed.push({ quest_id: row.quest_id, status: row.status, progress: row.progress });
    }
    return completed;
  }

  async claimReward(identityId, questId) {
    const quest = await this.findQuestById(questId);
    if (!quest) return { error: 'quest_not_found' };
    const key = this._key(identityId, questId);
    const row = this.progress.get(key);
    if (!row || row.status !== 'completed') return { error: 'quest_not_completed' };
    row.status = 'claimed';
    row.reward_claimed_at = Date.now();
    row.updated_at = Date.now();
    const reward = { kind: quest.reward_kind, data: quest.reward_data };
    if (quest.reward_kind === 'title' && quest.reward_data?.title) {
      if (this.titleStore) {
        await this.titleStore.unlockTitle(identityId, quest.reward_data.title);
        await this.titleStore.equipTitle(identityId, quest.reward_data.title);
      } else {
        this.titles.set(identityId, quest.reward_data.title);
      }
    }
    return { progress: row, reward };
  }

  async listQuestsForIdentity(identityId) {
    return [...this.quests.values()].filter(q => q.active).map(q => {
      const p = this.progress.get(this._key(identityId, q.id));
      return { ...q, status: p?.status ?? 'available', progress: p?.progress ?? {} };
    });
  }

  async getEquippedTitle(identityId) {
    if (this.titleStore) return this.titleStore.getEquippedTitle(identityId);
    return this.titles.get(identityId) ?? null;
  }

  // Test helper: seed a quest without a database.
  setQuest(quest) { this.quests.set(quest.id, quest); }
}
