export class PostgresResourceNodeStore {
  constructor(pool) {
    if (!pool) throw new Error('PostgreSQL pool is required');
    this.pool = pool;
  }

  async listNodesForMap(map) {
    const result = await this.pool.query(
      `SELECT id, slug, kind, map, x, y, level, respawn_seconds, active, last_harvested_at
       FROM resource_nodes
       WHERE map = $1 AND active = true`,
      [map]
    );
    return result.rows.map(row => this._format(row));
  }

  async findNodeBySlug(slug) {
    const result = await this.pool.query(
      `SELECT id, slug, kind, map, x, y, level, respawn_seconds, active, last_harvested_at
       FROM resource_nodes
       WHERE slug = $1 AND active = true`,
      [slug]
    );
    return result.rowCount ? this._format(result.rows[0]) : null;
  }

  async findNodeById(id) {
    const result = await this.pool.query(
      `SELECT id, slug, kind, map, x, y, level, respawn_seconds, active, last_harvested_at
       FROM resource_nodes
       WHERE id = $1 AND active = true`,
      [id]
    );
    return result.rowCount ? this._format(result.rows[0]) : null;
  }

  async harvestNode(slug) {
    const result = await this.pool.query(
      `UPDATE resource_nodes
       SET last_harvested_at = now(), updated_at = now()
       WHERE slug = $1 AND active = true
       RETURNING id, slug, kind, map, x, y, level, respawn_seconds, active, last_harvested_at`,
      [slug]
    );
    return result.rowCount ? this._format(result.rows[0]) : null;
  }

  _format(row) {
    const now = Date.now();
    const harvestedAt = row.last_harvested_at ? new Date(row.last_harvested_at).getTime() : 0;
    const respawnMs = row.respawn_seconds * 1000;
    const available = !harvestedAt || (now - harvestedAt) >= respawnMs;
    const remainingMs = available ? 0 : Math.max(0, respawnMs - (now - harvestedAt));
    return {
      id: row.id,
      slug: row.slug,
      kind: row.kind,
      map: row.map,
      x: row.x,
      y: row.y,
      level: row.level,
      respawn_seconds: row.respawn_seconds,
      active: row.active,
      available,
      respawn_in_ms: remainingMs
    };
  }
}

export class MemoryResourceNodeStore {
  constructor() {
    this.nodes = new Map([
      ['littleroot-apple-tree', {
        id: 'littleroot-apple-tree',
        slug: 'littleroot-apple-tree',
        kind: 'tree',
        map: '0-9',
        x: 12,
        y: 13,
        level: 1,
        respawn_seconds: 30,
        active: true,
        lastHarvestedAt: 0
      }]
    ]);
  }

  async listNodesForMap(map) {
    return [...this.nodes.values()].filter(n => n.map === map && n.active).map(n => this._format(n));
  }

  async findNodeBySlug(slug) {
    const node = this.nodes.get(slug);
    return node?.active ? this._format(node) : null;
  }

  async findNodeById(id) {
    return this.findNodeBySlug(id);
  }

  async harvestNode(slug) {
    const node = this.nodes.get(slug);
    if (!node || !node.active) return null;
    node.lastHarvestedAt = Date.now();
    return this._format(node);
  }

  _format(node) {
    const now = Date.now();
    const respawnMs = node.respawn_seconds * 1000;
    const available = !node.lastHarvestedAt || (now - node.lastHarvestedAt) >= respawnMs;
    const remainingMs = available ? 0 : Math.max(0, respawnMs - (now - node.lastHarvestedAt));
    return {
      id: node.id,
      slug: node.slug,
      kind: node.kind,
      map: node.map,
      x: node.x,
      y: node.y,
      level: node.level,
      respawn_seconds: node.respawn_seconds,
      active: node.active,
      available,
      respawn_in_ms: remainingMs
    };
  }

  // Test helper: add a node without a database.
  setNode(slug, node) {
    this.nodes.set(slug, { ...node, slug, lastHarvestedAt: node.lastHarvestedAt ?? 0 });
  }
}
