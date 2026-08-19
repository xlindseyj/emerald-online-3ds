export class PostgresSkillStore {
  constructor(pool) {
    if (!pool) throw new Error('PostgreSQL pool is required');
    this.pool = pool;
  }

  xpForLevel(level) {
    // RuneScape-style XP curve: xp = floor(sum(level^2 / 8 + level * 2 + 50) ... )
    // Simplified: xp = 25 * level * level - 25 * level for level >= 1.
    if (level <= 1) return 0;
    return 25 * level * level - 25 * level;
  }

  levelForXp(xp) {
    let level = 1;
    while (level < 99 && xp >= this.xpForLevel(level + 1)) level++;
    return level;
  }

  async getSkill(identityId, skill) {
    const result = await this.pool.query(
      `SELECT skill, xp, level FROM player_skills WHERE identity_id = $1 AND skill = $2`,
      [identityId, skill]
    );
    return result.rowCount
      ? { skill: result.rows[0].skill, xp: result.rows[0].xp, level: result.rows[0].level }
      : { skill, xp: 0, level: 1 };
  }

  async addXp(identityId, skill, xp, client = null) {
    if (!Number.isInteger(xp) || xp <= 0) throw new Error('xp must be a positive integer');
    const executor = client ?? this.pool;
    const result = await executor.query(
      `INSERT INTO player_skills (identity_id, skill, xp, level)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (identity_id, skill) DO UPDATE
       SET xp = player_skills.xp + EXCLUDED.xp,
           level = EXCLUDED.level,
           updated_at = now()
       RETURNING skill, xp, level`,
      [identityId, skill, xp, this.levelForXp(xp)]
    );
    // Recompute level after adding XP in case it leveled up.
    const row = result.rows[0];
    const newLevel = this.levelForXp(row.xp);
    if (newLevel !== row.level) {
      const update = await executor.query(
        `UPDATE player_skills SET level = $1, updated_at = now()
         WHERE identity_id = $2 AND skill = $3
         RETURNING skill, xp, level`,
        [newLevel, identityId, skill]
      );
      return update.rows[0];
    }
    return row;
  }
}

export class MemorySkillStore {
  constructor() {
    this.skills = new Map(); // key: `${identityId}:${skill}`
  }

  xpForLevel(level) {
    if (level <= 1) return 0;
    return 25 * level * level - 25 * level;
  }

  levelForXp(xp) {
    let level = 1;
    while (level < 99 && xp >= this.xpForLevel(level + 1)) level++;
    return level;
  }

  async getSkill(identityId, skill) {
    return this.skills.get(`${identityId}:${skill}`) ?? { skill, xp: 0, level: 1 };
  }

  async addXp(identityId, skill, xp) {
    if (!Number.isInteger(xp) || xp <= 0) throw new Error('xp must be a positive integer');
    const key = `${identityId}:${skill}`;
    const current = this.skills.get(key) ?? { skill, xp: 0, level: 1 };
    const nextXp = current.xp + xp;
    const nextLevel = this.levelForXp(nextXp);
    const next = { skill, xp: nextXp, level: nextLevel };
    this.skills.set(key, next);
    return next;
  }
}
