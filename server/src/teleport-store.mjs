const BUILTIN_DESTINATIONS = [
  // Gyms
  { id: 'gym:rustboro', name: 'Rustboro Gym', kind: 'gym', map_group: 0, map_num: 2, x: 8, y: 12, facing: 'down' },
  { id: 'gym:dewford', name: 'Dewford Gym', kind: 'gym', map_group: 0, map_num: 3, x: 8, y: 12, facing: 'down' },
  { id: 'gym:mauville', name: 'Mauville Gym', kind: 'gym', map_group: 0, map_num: 4, x: 8, y: 12, facing: 'down' },
  { id: 'gym:lavaridge', name: 'Lavaridge Gym', kind: 'gym', map_group: 0, map_num: 5, x: 8, y: 12, facing: 'down' },
  { id: 'gym:petalburg', name: 'Petalburg Gym', kind: 'gym', map_group: 0, map_num: 6, x: 8, y: 12, facing: 'down' },
  { id: 'gym:fortree', name: 'Fortree Gym', kind: 'gym', map_group: 0, map_num: 7, x: 8, y: 12, facing: 'down' },
  { id: 'gym:mossdeep', name: 'Mossdeep Gym', kind: 'gym', map_group: 0, map_num: 8, x: 8, y: 12, facing: 'down' },
  { id: 'gym:sootopolis', name: 'Sootopolis Gym', kind: 'gym', map_group: 0, map_num: 9, x: 8, y: 12, facing: 'down' },
  // Important locations
  { id: 'location:elite-four', name: 'Elite Four', kind: 'location', map_group: 0, map_num: 10, x: 8, y: 12, facing: 'down' },
  { id: 'location:champion', name: 'Champion Room', kind: 'location', map_group: 0, map_num: 11, x: 8, y: 12, facing: 'down' },
  { id: 'location:battle-frontier', name: 'Battle Frontier', kind: 'location', map_group: 0, map_num: 12, x: 8, y: 12, facing: 'down' },
  { id: 'location:lilycove', name: 'Lilycove City', kind: 'location', map_group: 0, map_num: 13, x: 8, y: 12, facing: 'down' },
  { id: 'location:slateport', name: 'Slateport City', kind: 'location', map_group: 0, map_num: 14, x: 8, y: 12, facing: 'down' },
  { id: 'location:ever-grande', name: 'Ever Grande City', kind: 'location', map_group: 0, map_num: 15, x: 8, y: 12, facing: 'down' },
  // Mom's house
  { id: 'mom', name: "Mom's House", kind: 'mom', map_group: 0, map_num: 16, x: 8, y: 12, facing: 'down' }
];

export function listBuiltInDestinations() {
  return BUILTIN_DESTINATIONS.map(d => ({ id: d.id, name: d.name, kind: d.kind }));
}

export function resolveBuiltInDestination(id) {
  return BUILTIN_DESTINATIONS.find(d => d.id === id) ?? null;
}

export class PostgresTeleportStore {
  constructor(pool) {
    if (!pool) throw new Error('PostgreSQL pool is required');
    this.pool = pool;
  }

  async listCustomDestinations() {
    const result = await this.pool.query(
      'SELECT id, name, map_group, map_num, x, y, facing FROM teleport_destinations ORDER BY created_at DESC'
    );
    return result.rows.map(row => ({
      id: `custom:${row.id}`,
      name: row.name,
      kind: 'custom',
      map_group: row.map_group,
      map_num: row.map_num,
      x: row.x,
      y: row.y,
      facing: row.facing
    }));
  }

  async resolveCustomDestination(id) {
    const uuid = id.startsWith('custom:') ? id.slice(7) : id;
    const result = await this.pool.query(
      'SELECT name, map_group, map_num, x, y, facing FROM teleport_destinations WHERE id=$1',
      [uuid]
    );
    if (!result.rowCount) return null;
    const row = result.rows[0];
    return { id, name: row.name, kind: 'custom', map_group: row.map_group, map_num: row.map_num, x: row.x, y: row.y, facing: row.facing };
  }

  async auditTeleport(identityId, destinationId, details = {}) {
    await this.pool.query(
      "INSERT INTO moderation_audit (actor_identity_id, action, details) VALUES ($1, 'teleport', $2)",
      [identityId, JSON.stringify({ destination_id: destinationId, ...details })]
    );
  }
}

export class MemoryTeleportStore {
  constructor() { this.destinations = new Map(); this.auditLog = []; }

  async listCustomDestinations() {
    return [...this.destinations.values()].map(d => ({ id: `custom:${d.id}`, name: d.name, kind: 'custom' }));
  }

  async resolveCustomDestination(id) {
    const uuid = id.startsWith('custom:') ? id.slice(7) : id;
    return this.destinations.get(uuid) ?? null;
  }

  async auditTeleport(identityId, destinationId, details = {}) {
    this.auditLog.push({ actor_identity_id: identityId, action: 'teleport', details: { destination_id: destinationId, ...details }, created_at: Date.now() });
  }

  // Test helper: add a custom destination without DB.
  addCustomDestination({ id, name, map_group, map_num, x, y, facing }) {
    this.destinations.set(id, { id: `custom:${id}`, name, kind: 'custom', map_group, map_num, x, y, facing });
  }
}
