import crypto from 'node:crypto';

const FIELDS = new Set(['pokedex_seen', 'pokedex_caught', 'badges', 'frontier_streaks']);
const FACILITIES = new Set(['tower', 'dome', 'palace', 'arena', 'factory', 'pike', 'pyramid']);
const MODES = new Set(['singles', 'doubles']);
const LEVELS = new Set(['50', 'open']);
const RELEASE = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-z0-9.-]+)?$/i;

export const STAT_FIELDS = Object.freeze([...FIELDS]);

export function normalizeConsent(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
  const normalized = {};
  for (const field of FIELDS) {
    if (typeof fields[field] !== 'boolean') return null;
    normalized[field] = fields[field];
  }
  if (Object.keys(fields).some(field => !FIELDS.has(field))) return null;
  return normalized;
}

function scalar(value, max) {
  return Number.isInteger(value) && value >= 0 && value <= max ? value : null;
}

export function normalizeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !RELEASE.test(snapshot.release ?? '')) return null;
  const values = snapshot.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return null;
  const allowed = new Set(['pokedex_seen', 'pokedex_caught', 'badges', 'frontier_streaks']);
  if (Object.keys(values).some(field => !allowed.has(field))) return null;
  const result = { release: snapshot.release, values: {} };
  if ('pokedex_seen' in values) {
    const value = scalar(values.pokedex_seen, 386); if (value === null) return null; result.values.pokedex_seen = value;
  }
  if ('pokedex_caught' in values) {
    const value = scalar(values.pokedex_caught, 386); if (value === null) return null; result.values.pokedex_caught = value;
  }
  if ('badges' in values) {
    const value = scalar(values.badges, 8); if (value === null) return null; result.values.badges = value;
  }
  if ('frontier_streaks' in values) {
    if (!Array.isArray(values.frontier_streaks) || values.frontier_streaks.length > 24) return null;
    const seen = new Set();
    result.values.frontier_streaks = [];
    for (const item of values.frontier_streaks) {
      if (!item || !FACILITIES.has(item.facility) || !MODES.has(item.mode) || !LEVELS.has(item.level)) return null;
      if (['arena', 'pike', 'pyramid'].includes(item.facility) && item.mode !== 'singles') return null;
      const streak = scalar(item.streak, 9999); if (streak === null) return null;
      const key = `${item.facility}:${item.mode}:${item.level}`; if (seen.has(key)) return null; seen.add(key);
      result.values.frontier_streaks.push({ facility: item.facility, mode: item.mode, level: item.level, streak });
    }
  }
  if ('pokedex_seen' in result.values && 'pokedex_caught' in result.values && result.values.pokedex_caught > result.values.pokedex_seen) return null;
  if (!Object.keys(result.values).length) return null;
  return result;
}

function entries(snapshot) {
  const output = [];
  if ('pokedex_seen' in snapshot.values) output.push({ field: 'pokedex_seen', board: 'pokedex-seen', variant: '', score: snapshot.values.pokedex_seen });
  if ('pokedex_caught' in snapshot.values) output.push({ field: 'pokedex_caught', board: 'pokedex-caught', variant: '', score: snapshot.values.pokedex_caught });
  if ('badges' in snapshot.values) output.push({ field: 'badges', board: 'badges', variant: '', score: snapshot.values.badges });
  for (const streak of snapshot.values.frontier_streaks ?? []) output.push({ field: 'frontier_streaks', board: 'frontier-streak', variant: `${streak.facility}:${streak.mode}:${streak.level}`, score: streak.streak });
  return output;
}

function anomaly(previous, next, elapsedMs) {
  if (!previous || next <= previous.score) return null;
  const gain = next - previous.score;
  const fast = elapsedMs < 6 * 60 * 60 * 1000;
  if (previous.board.startsWith('pokedex-') && fast && gain > 80) return 'rapid_pokedex_increase';
  if (previous.board === 'frontier-streak' && fast && gain > 250) return 'rapid_frontier_increase';
  return null;
}

export class PostgresStatsStore {
  constructor(pool) { this.pool = pool; }

  async setConsent(identityId, credentialId, enabled, fields, deleteHistory = false) {
    const normalized = normalizeConsent(fields); if (!normalized || typeof enabled !== 'boolean') return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const owns = await client.query('SELECT 1 FROM device_credentials WHERE id=$1 AND identity_id=$2 AND revoked_at IS NULL', [credentialId, identityId]);
      if (!owns.rowCount) { await client.query('ROLLBACK'); return null; }
      if (deleteHistory) {
        await client.query('DELETE FROM leaderboard_entries WHERE identity_id=$1 AND credential_id=$2', [identityId, credentialId]);
        await client.query('DELETE FROM device_stat_consent WHERE credential_id=$1 AND identity_id=$2', [credentialId, identityId]);
      } else {
        await client.query(`INSERT INTO device_stat_consent(credential_id, identity_id, enabled, fields) VALUES($1,$2,$3,$4)
          ON CONFLICT (credential_id) DO UPDATE SET enabled=excluded.enabled, fields=excluded.fields, updated_at=now()`, [credentialId, identityId, enabled, normalized]);
        for (const [field, allowed] of Object.entries(normalized)) if (!enabled || !allowed) {
          const boards = field === 'frontier_streaks' ? ['frontier-streak'] : [field.replaceAll('_', '-')];
          await client.query('DELETE FROM leaderboard_entries WHERE identity_id=$1 AND credential_id=$2 AND board=ANY($3)', [identityId, credentialId, boards]);
        }
      }
      await client.query('COMMIT');
      return { enabled: deleteHistory ? false : enabled, fields: deleteHistory ? Object.fromEntries(STAT_FIELDS.map(field => [field, false])) : normalized, deleted: deleteHistory };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async submitSnapshot(identityId, credentialId, input) {
    const snapshot = normalizeSnapshot(input); if (!snapshot) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const consentResult = await client.query('SELECT enabled, fields, updated_at FROM device_stat_consent WHERE credential_id=$1 AND identity_id=$2 FOR UPDATE', [credentialId, identityId]);
      const consent = consentResult.rows[0];
      if (!consent?.enabled) { await client.query('ROLLBACK'); return { accepted: false, error: 'stats_consent_required' }; }
      const requested = entries(snapshot);
      if (requested.some(entry => consent.fields[entry.field] !== true)) { await client.query('ROLLBACK'); return { accepted: false, error: 'stats_field_not_consented' }; }
      const results = [];
      for (const entry of requested) {
        const priorResult = await client.query(`SELECT id, board, score, updated_at FROM leaderboard_entries
          WHERE credential_id=$1 AND release_version=$2 AND board=$3 AND variant=$4 FOR UPDATE`, [credentialId, snapshot.release, entry.board, entry.variant]);
        const prior = priorResult.rows[0];
        const reason = anomaly(prior, entry.score, prior ? Date.now() - new Date(prior.updated_at).getTime() : Infinity);
        const status = reason ? 'under-review' : 'accepted';
        const label = reason ? 'Under review' : 'Community-submitted';
        const saved = await client.query(`INSERT INTO leaderboard_entries(identity_id,credential_id,release_version,board,variant,score,integrity_label,review_status,review_reason)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
          ON CONFLICT (credential_id,release_version,board,variant) DO UPDATE SET
            score=CASE WHEN excluded.review_status='under-review' THEN leaderboard_entries.score ELSE GREATEST(leaderboard_entries.score,excluded.score) END,
            pending_score=CASE WHEN excluded.review_status='under-review' THEN GREATEST(COALESCE(leaderboard_entries.pending_score,0),excluded.score) ELSE leaderboard_entries.pending_score END,
            integrity_label=leaderboard_entries.integrity_label,
            review_status=CASE WHEN excluded.review_status='under-review' THEN 'under-review' ELSE leaderboard_entries.review_status END,
            review_reason=COALESCE(excluded.review_reason,leaderboard_entries.review_reason),updated_at=now()
          RETURNING id, score, pending_score, integrity_label, review_status`, [identityId, credentialId, snapshot.release, entry.board, entry.variant, entry.score, label, status, reason]);
        await client.query('INSERT INTO stat_snapshot_history(entry_id,submitted_score,review_status,review_reason) VALUES($1,$2,$3,$4)', [saved.rows[0].id, entry.score, status, reason]);
        results.push({ board: entry.board, variant: entry.variant, ...saved.rows[0] });
      }
      await client.query('COMMIT');
      return { accepted: true, entries: results };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async profile(identityId) {
    const consent = await this.pool.query('SELECT bool_or(enabled) AS enabled FROM device_stat_consent WHERE identity_id=$1', [identityId]);
    const scores = await this.pool.query(`SELECT release_version,board,variant,max(score)::int score,integrity_label,review_status FROM leaderboard_entries WHERE identity_id=$1 GROUP BY release_version,board,variant,integrity_label,review_status ORDER BY release_version DESC,board,variant`, [identityId]);
    const compatibility=await this.pool.query(`SELECT release_version,'beta-compatibility' board,'' variant,count(*)::int score,'Server-observed' integrity_label,'accepted' review_status
      FROM compatibility_reports WHERE identity_id=$1 GROUP BY release_version ORDER BY release_version DESC`,[identityId]);
    return { enabled: Boolean(consent.rows[0]?.enabled), scores: [...scores.rows,...compatibility.rows] };
  }

  async listBoards({ board = 'pokedex-caught', variant = '', release = '0.6.0', page = 1, pageSize = 25 } = {}) {
    const policy = await this.pool.query('SELECT board,enabled,integrity_label,explanation FROM leaderboard_board_policy WHERE board=$1', [board]);
    if (!policy.rowCount) return null;
    const safePage = Number.isSafeInteger(page) && page > 0 ? page : 1;
    const values = [release, board, variant, pageSize, (safePage - 1) * pageSize];
    const rows = !policy.rows[0].enabled ? {rows:[]} : board==='beta-compatibility' ? await this.pool.query(`WITH ranked AS (
      SELECT i.fingerprint,count(*)::int score,'Server-observed'::text integrity_label,min(r.created_at) updated_at
      FROM compatibility_reports r JOIN identities i ON i.id=r.identity_id
      WHERE r.release_version=$1 AND $2='beta-compatibility' AND $3='' AND i.deleted_at IS NULL GROUP BY i.id,i.fingerprint)
      SELECT fingerprint,score,integrity_label,updated_at,count(*) OVER()::int total,rank() OVER(ORDER BY score DESC,updated_at ASC) rank
      FROM ranked ORDER BY score DESC,updated_at ASC LIMIT $4 OFFSET $5`,values) : await this.pool.query(`WITH ranked AS (
      SELECT i.fingerprint,max(e.score)::int score,min(e.integrity_label) integrity_label,min(e.updated_at) updated_at
      FROM leaderboard_entries e JOIN identities i ON i.id=e.identity_id
      WHERE e.release_version=$1 AND e.board=$2 AND e.variant=$3 AND i.deleted_at IS NULL
      GROUP BY i.id,i.fingerprint)
      SELECT fingerprint,score,integrity_label,updated_at,count(*) OVER()::int total,rank() OVER(ORDER BY score DESC,updated_at ASC) rank
      FROM ranked ORDER BY score DESC,updated_at ASC LIMIT $4 OFFSET $5`, values);
    const total = rows.rows[0]?.total ?? 0;
    return { policy: policy.rows[0], release, board, variant, page: safePage, pageSize, total, pages: Math.max(1, Math.ceil(total / pageSize)), entries: rows.rows.map(({ total: _total, ...entry }) => entry) };
  }

  async deleteIdentityStats(identityId) {
    const client=await this.pool.connect();try{await client.query('BEGIN');const result=await client.query('DELETE FROM leaderboard_entries WHERE identity_id=$1',[identityId]);await client.query('DELETE FROM device_stat_consent WHERE identity_id=$1',[identityId]);await client.query('DELETE FROM compatibility_reports WHERE identity_id=$1',[identityId]);await client.query('COMMIT');return result.rowCount}catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }

  async reportCompatibility(identityId,report){
    const result=await this.pool.query(`INSERT INTO compatibility_reports(identity_id,release_version,artifact_hash,console_model,install_method,transport,result,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(identity_id,release_version,artifact_hash,console_model,install_method,transport)
      DO UPDATE SET result=excluded.result,notes=excluded.notes,updated_at=now() RETURNING id,created_at,updated_at`,[identityId,report.release,report.artifactHash,report.consoleModel,report.installMethod,report.transport,report.result,report.notes]);return result.rows[0]
  }

  async listUnderReview() {
    const result = await this.pool.query(`SELECT e.id,i.fingerprint,e.release_version,e.board,e.variant,e.pending_score AS score,e.score AS accepted_score,e.review_reason,e.updated_at
      FROM leaderboard_entries e JOIN identities i ON i.id=e.identity_id
      WHERE e.review_status='under-review' ORDER BY e.updated_at ASC LIMIT 200`);
    return result.rows;
  }

  async resolveReview(entryId, decision, actorIdentityId) {
    const client=await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current=await client.query("SELECT id,identity_id,board,variant,score FROM leaderboard_entries WHERE id=$1 AND review_status='under-review' FOR UPDATE",[entryId]);
      if(!current.rowCount){await client.query('ROLLBACK');return false}
      if(current.rows[0].identity_id===actorIdentityId){await client.query('ROLLBACK');return false}
      if(decision==='accept') await client.query("UPDATE leaderboard_entries SET score=GREATEST(score,pending_score),pending_score=NULL,review_status='accepted',integrity_label='Community-submitted',review_reason=NULL,updated_at=now() WHERE id=$1",[entryId]);
      else if(decision==='dismiss') await client.query("UPDATE leaderboard_entries SET pending_score=NULL,review_status='accepted',integrity_label='Community-submitted',review_reason=NULL,updated_at=now() WHERE id=$1",[entryId]);
      else {await client.query('ROLLBACK');return false}
      await client.query(`INSERT INTO moderation_audit(actor_identity_id,target_identity_id,action,details)
        VALUES($1,$2,'leaderboard_review_resolved',$3)`,[actorIdentityId,current.rows[0].identity_id,{entryId,decision,board:current.rows[0].board,variant:current.rows[0].variant,score:current.rows[0].score}]);
      await client.query('COMMIT'); return true;
    }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
  }
}

export class MemoryStatsStore {
  constructor() { this.consents = new Map(); this.rows = []; this.compatibility=[]; }
  key(identityId, credentialId) { return `${identityId}:${credentialId}`; }
  async setConsent(identityId, credentialId, enabled, fields, deleteHistory = false) {
    const normalized = normalizeConsent(fields); if (!normalized || typeof enabled !== 'boolean') return null;
    const key = this.key(identityId, credentialId);
    if (deleteHistory) { this.consents.delete(key); this.rows = this.rows.filter(row => row.identityId !== identityId || row.credentialId !== credentialId); return { enabled: false, fields: Object.fromEntries(STAT_FIELDS.map(field => [field, false])), deleted: true }; }
    this.consents.set(key, { enabled, fields: normalized });
    this.rows = this.rows.filter(row => row.identityId !== identityId || row.credentialId !== credentialId || (enabled && normalized[row.field]));
    return { enabled, fields: normalized, deleted: false };
  }
  async submitSnapshot(identityId, credentialId, input) {
    const snapshot = normalizeSnapshot(input); if (!snapshot) return null;
    const consent = this.consents.get(this.key(identityId, credentialId)); if (!consent?.enabled) return { accepted: false, error: 'stats_consent_required' };
    const requested = entries(snapshot); if (requested.some(entry => !consent.fields[entry.field])) return { accepted: false, error: 'stats_field_not_consented' };
    const results = [];
    for (const entry of requested) {
      let row = this.rows.find(value => value.identityId === identityId && value.credentialId === credentialId && value.release === snapshot.release && value.board === entry.board && value.variant === entry.variant);
      if (!row) { row = { id:crypto.randomUUID(),identityId, credentialId, release: snapshot.release, ...entry, integrity_label: 'Community-submitted', review_status: 'accepted', updated_at: new Date() }; this.rows.push(row); }
      else { row.score = Math.max(row.score, entry.score); row.updated_at = new Date(); }
      results.push(row);
    }
    return { accepted: true, entries: results };
  }
  async profile(identityId) { const scores=this.rows.filter(row => row.identityId === identityId).map(({credentialId:_credentialId,identityId:_identityId,...row})=>row);const counts=new Map();for(const row of this.compatibility.filter(row=>row.identityId===identityId))counts.set(row.release,(counts.get(row.release)??0)+1);for(const [release,score]of counts)scores.push({release,board:'beta-compatibility',variant:'',score,integrity_label:'Server-observed',review_status:'accepted'});return { enabled: [...this.consents.entries()].some(([key,value]) => key.startsWith(`${identityId}:`) && value.enabled), scores }; }
  async listBoards({ board='pokedex-caught',variant='',release='0.6.0',page=1,pageSize=25 }={}) {
    const disabled = ['online-battles','online-trades'].includes(board); const grouped = new Map();
    if(board==='beta-compatibility')for(const row of this.compatibility.filter(row=>row.release===release))grouped.set(row.identityId,(grouped.get(row.identityId)??0)+1);else if (!disabled) for (const row of this.rows.filter(row => row.board===board&&row.variant===variant&&row.release===release&&row.review_status==='accepted')) grouped.set(row.identityId, Math.max(grouped.get(row.identityId) ?? 0,row.score));
    const entries = [...grouped].sort((a,b)=>b[1]-a[1]).map(([fingerprint,score],index)=>({fingerprint:fingerprint.slice(0,12),score,rank:index+1}));
    return { policy:{board,enabled:!disabled,integrity_label:disabled?'Peer-confirmed':board==='beta-compatibility'?'Server-observed':'Community-submitted',explanation:disabled?'Disabled until physical result validation.':board==='beta-compatibility'?'Counts qualifying compatibility reports received by the beta service.':'Client-submitted with explicit consent.'},release,board,variant,page,pageSize,total:entries.length,pages:Math.max(1,Math.ceil(entries.length/pageSize)),entries:entries.slice((page-1)*pageSize,page*pageSize) };
  }
  async deleteIdentityStats(identityId) { const before=this.rows.length; this.rows=this.rows.filter(row=>row.identityId!==identityId);this.compatibility=this.compatibility.filter(row=>row.identityId!==identityId); for(const key of this.consents.keys())if(key.startsWith(`${identityId}:`))this.consents.delete(key); return before-this.rows.length; }
  async reportCompatibility(identityId,report){const key=row=>[row.identityId,row.release,row.artifactHash,row.consoleModel,row.installMethod,row.transport].join(':');const candidate={id:crypto.randomUUID(),identityId,...report};const index=this.compatibility.findIndex(row=>key(row)===key(candidate));if(index>=0){candidate.id=this.compatibility[index].id;this.compatibility[index]=candidate}else this.compatibility.push(candidate);return {id:candidate.id}}
  async listUnderReview(){return this.rows.filter(row=>row.review_status==='under-review').map(row=>({...row,identityId:undefined,credentialId:undefined}))}
  async resolveReview(entryId,decision){const index=this.rows.findIndex(row=>row.id===entryId&&row.review_status==='under-review');if(index<0)return false;if(decision==='accept'){this.rows[index].review_status='accepted';this.rows[index].integrity_label='Community-submitted'}else if(decision==='dismiss')this.rows.splice(index,1);else return false;return true}
}
