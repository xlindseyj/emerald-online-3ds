import crypto from 'node:crypto';

const PUBLIC_DEFECT_STATES = new Set(['confirmed', 'fixed', 'closed']);

function pageBounds(page, pageSize) {
  const safePage = Number.isInteger(page) && page > 0 ? page : 1;
  const safeSize = Number.isInteger(pageSize) ? Math.min(Math.max(pageSize, 1), 50) : 20;
  return { page: safePage, pageSize: safeSize, offset: (safePage - 1) * safeSize };
}

function viewerValues(viewer = null) {
  return { identityId: viewer?.identity_id ?? null, moderator: viewer?.is_moderator === true };
}

export class PostgresCommunityStore {
  constructor(pool) {
    if (!pool) throw new Error('PostgreSQL pool is required');
    this.pool = pool;
  }

  async categories(viewer) {
    const { identityId, moderator } = viewerValues(viewer);
    const result = await this.pool.query(
      `SELECT slug, name, description, visibility, position,
        CASE WHEN visibility='public' OR slug='bugs-defects' OR ($1::uuid IS NOT NULL AND visibility='paired') OR $2::boolean THEN true ELSE false END AS readable
       FROM forum_categories ORDER BY position, name`,
      [identityId, moderator]
    );
    return result.rows;
  }

  async listTopics({ category = null, query = '', page = 1, pageSize = 20, viewer = null } = {}) {
    const { identityId, moderator } = viewerValues(viewer), bounds = pageBounds(page, pageSize);
    const search = typeof query === 'string' ? query.trim().slice(0, 120) : '';
    const result = await this.pool.query(
      `SELECT t.id, t.category_slug, c.name AS category_name, t.title, t.pinned, t.locked,
        t.created_at, t.updated_at, i.fingerprint AS author_fingerprint,
        count(p.id) FILTER (WHERE p.deleted_at IS NULL)::int AS reply_count,
        d.id AS defect_id, d.severity, d.status AS defect_status
       FROM forum_topics t
       JOIN forum_categories c ON c.slug=t.category_slug
       LEFT JOIN identities i ON i.id=t.author_identity_id
       LEFT JOIN forum_posts p ON p.topic_id=t.id
       LEFT JOIN defects d ON d.topic_id=t.id
       WHERE t.deleted_at IS NULL
         AND ($1::text IS NULL OR t.category_slug=$1)
         AND ($2::text='' OR to_tsvector('simple', t.title || ' ' || t.body_markdown) @@ plainto_tsquery('simple', $2))
         AND (c.visibility='public' OR ($3::uuid IS NOT NULL AND c.visibility='paired') OR $4::boolean
              OR (t.category_slug='bugs-defects' AND d.status IN ('confirmed','fixed','closed')))
       GROUP BY t.id, c.name, i.fingerprint, d.id, d.severity, d.status
       ORDER BY t.pinned DESC, t.updated_at DESC
       LIMIT $5 OFFSET $6`,
      [category, search, identityId, moderator, bounds.pageSize, bounds.offset]
    );
    return { ...bounds, topics: result.rows };
  }

  async getTopic(topicId, viewer = null) {
    const { identityId, moderator } = viewerValues(viewer);
    const topicResult = await this.pool.query(
      `SELECT t.*, c.name AS category_name, c.visibility, i.fingerprint AS author_fingerprint,
        d.id AS defect_id, d.severity, d.reproduction_steps, d.expected_behavior, d.actual_behavior,
        d.runtime_version, d.artifact_hash, d.console_model, d.install_method, d.transport,
        d.diagnostic_text, d.status AS defect_status, d.target_release, d.related_change, d.duplicate_of,
        EXISTS (SELECT 1 FROM forum_subscriptions s WHERE s.topic_id=t.id AND s.identity_id=$2) AS subscribed
       FROM forum_topics t JOIN forum_categories c ON c.slug=t.category_slug
       LEFT JOIN identities i ON i.id=t.author_identity_id
       LEFT JOIN defects d ON d.topic_id=t.id
       WHERE t.id=$1 AND (t.deleted_at IS NULL OR $3::boolean)
         AND (c.visibility='public' OR ($2::uuid IS NOT NULL AND c.visibility='paired') OR $3::boolean
              OR (t.category_slug='bugs-defects' AND d.status IN ('confirmed','fixed','closed')))`,
      [topicId, identityId, moderator]
    );
    if (!topicResult.rowCount) return null;
    const posts = await this.pool.query(
      `SELECT p.id, p.body_markdown, p.created_at, p.updated_at, p.deleted_at, i.fingerprint AS author_fingerprint
       FROM forum_posts p LEFT JOIN identities i ON i.id=p.author_identity_id
       WHERE p.topic_id=$1 AND (p.deleted_at IS NULL OR $2::boolean) ORDER BY p.created_at`,
      [topicId, moderator]
    );
    return { ...topicResult.rows[0], posts: posts.rows };
  }

  async createTopic({ category, title, body, defect = null }, viewer) {
    const { identityId, moderator } = viewerValues(viewer);
    if (!identityId) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const allowed = await client.query(
        `SELECT visibility FROM forum_categories WHERE slug=$1
         AND (visibility IN ('public','paired') OR $2::boolean)
         AND (slug NOT IN ('announcements','releases','service-status') OR $2::boolean)
         AND ($2::boolean OR NOT EXISTS (SELECT 1 FROM identity_sanctions s WHERE s.identity_id=$3
           AND s.kind IN ('read-only','suspended') AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>now()))) FOR SHARE`,
        [category, moderator, identityId]
      );
      if (!allowed.rowCount || (category === 'bugs-defects') !== Boolean(defect)) { await client.query('ROLLBACK'); return null; }
      const topic = await client.query(
        `INSERT INTO forum_topics (category_slug, author_identity_id, title, body_markdown)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [category, identityId, title, body]
      );
      if (defect) {
        await client.query(
          `INSERT INTO defects (topic_id, severity, reproduction_steps, expected_behavior, actual_behavior,
             runtime_version, artifact_hash, console_model, install_method, transport, diagnostic_text)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [topic.rows[0].id, defect.severity, defect.reproductionSteps, defect.expectedBehavior, defect.actualBehavior,
            defect.runtimeVersion, defect.artifactHash, defect.consoleModel, defect.installMethod, defect.transport, defect.diagnosticText ?? '']
        );
      }
      await client.query('INSERT INTO forum_subscriptions(identity_id,topic_id) VALUES($1,$2)', [identityId, topic.rows[0].id]);
      await client.query('COMMIT');
      return { id: topic.rows[0].id };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async updateTopic(topicId, { title, body }, viewer) {
    const { identityId, moderator } = viewerValues(viewer);
    const result = await this.pool.query(
      `UPDATE forum_topics SET title=COALESCE($2,title), body_markdown=COALESCE($3,body_markdown), updated_at=now()
       WHERE id=$1 AND deleted_at IS NULL AND (author_identity_id=$4 OR $5::boolean)
       AND ($5::boolean OR NOT EXISTS (SELECT 1 FROM identity_sanctions s WHERE s.identity_id=$4
         AND s.kind IN ('read-only','suspended') AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>now())))
       RETURNING id`,
      [topicId, title ?? null, body ?? null, identityId, moderator]
    );
    return result.rowCount === 1;
  }

  async deleteTopic(topicId, viewer) {
    const { identityId, moderator } = viewerValues(viewer);
    const result = await this.pool.query(
      `UPDATE forum_topics SET deleted_at=now(), purge_after=now()+interval '30 days', updated_at=now()
       WHERE id=$1 AND deleted_at IS NULL AND (author_identity_id=$2 OR $3::boolean) RETURNING id`,
      [topicId, identityId, moderator]
    );
    return result.rowCount === 1;
  }

  async createReply(topicId, body, viewer) {
    const { identityId, moderator } = viewerValues(viewer);
    if (!identityId) return null;
    const result = await this.pool.query(
      `WITH readable AS (
         SELECT t.id FROM forum_topics t JOIN forum_categories c ON c.slug=t.category_slug
         LEFT JOIN defects d ON d.topic_id=t.id
         WHERE t.id=$1 AND t.deleted_at IS NULL AND (NOT t.locked OR $4::boolean)
           AND (c.visibility='public' OR c.visibility='paired' OR $4::boolean)
           AND ($4::boolean OR NOT EXISTS (SELECT 1 FROM identity_sanctions s WHERE s.identity_id=$2
             AND s.kind IN ('read-only','suspended') AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>now())))
       ), inserted AS (
         INSERT INTO forum_posts(topic_id,author_identity_id,body_markdown)
         SELECT id,$2,$3 FROM readable RETURNING id
       ), touched AS (
         UPDATE forum_topics SET updated_at=now() WHERE id IN (SELECT id FROM readable)
       ) SELECT id FROM inserted`,
      [topicId, identityId, body, moderator]
    );
    return result.rows[0] ?? null;
  }

  async updateReply(postId, body, viewer) {
    const { identityId, moderator } = viewerValues(viewer);
    const result = await this.pool.query(
      `UPDATE forum_posts p SET body_markdown=$2, updated_at=now()
       FROM forum_topics t WHERE p.id=$1 AND t.id=p.topic_id AND p.deleted_at IS NULL
       AND (NOT t.locked OR $4::boolean) AND (p.author_identity_id=$3 OR $4::boolean)
       AND ($4::boolean OR NOT EXISTS (SELECT 1 FROM identity_sanctions s WHERE s.identity_id=$3
         AND s.kind IN ('read-only','suspended') AND s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>now()))) RETURNING p.id`,
      [postId, body, identityId, moderator]
    );
    return result.rowCount === 1;
  }

  async deleteReply(postId, viewer) {
    const { identityId, moderator } = viewerValues(viewer);
    const result = await this.pool.query(
      `UPDATE forum_posts SET deleted_at=now(), purge_after=now()+interval '30 days', updated_at=now()
       WHERE id=$1 AND deleted_at IS NULL AND (author_identity_id=$2 OR $3::boolean) RETURNING id`,
      [postId, identityId, moderator]
    );
    return result.rowCount === 1;
  }

  async setSubscription(topicId, subscribed, viewer) {
    const identityId = viewer?.identity_id;
    if (!identityId) return false;
    if (subscribed) await this.pool.query('INSERT INTO forum_subscriptions(identity_id,topic_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [identityId, topicId]);
    else await this.pool.query('DELETE FROM forum_subscriptions WHERE identity_id=$1 AND topic_id=$2', [identityId, topicId]);
    return true;
  }

  async report({ topicId = null, postId = null, reason }, viewer) {
    const identityId = viewer?.identity_id;
    if (!identityId) return null;
    const result = await this.pool.query(
      `WITH visible_target AS (
         SELECT t.id AS topic_id, NULL::uuid AS post_id FROM forum_topics t
         JOIN forum_categories c ON c.slug=t.category_slug LEFT JOIN defects d ON d.topic_id=t.id
         WHERE t.id=$2 AND t.deleted_at IS NULL
           AND (c.visibility IN ('public','paired') OR $5::boolean OR d.status IN ('confirmed','fixed','closed'))
         UNION ALL
         SELECT NULL::uuid AS topic_id, p.id FROM forum_posts p JOIN forum_topics t ON t.id=p.topic_id
         JOIN forum_categories c ON c.slug=t.category_slug LEFT JOIN defects d ON d.topic_id=t.id
         WHERE p.id=$3 AND p.deleted_at IS NULL AND t.deleted_at IS NULL
           AND (c.visibility IN ('public','paired') OR $5::boolean OR d.status IN ('confirmed','fixed','closed'))
       ) INSERT INTO forum_reports(reporter_identity_id,topic_id,post_id,reason)
       SELECT $1,topic_id,post_id,$4 FROM visible_target RETURNING id`,
      [identityId, topicId, postId, reason, viewer?.is_moderator === true]
    );
    return result.rows[0] ?? null;
  }

  async moderateTopic(topicId, { locked, pinned, category }, viewer) {
    if (viewer?.is_moderator !== true) return false;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE forum_topics SET locked=COALESCE($2,locked), pinned=COALESCE($3,pinned),
           category_slug=COALESCE($4,category_slug), updated_at=now() WHERE id=$1 RETURNING id`,
        [topicId, locked ?? null, pinned ?? null, category ?? null]
      );
      if (result.rowCount) await client.query(
        `INSERT INTO moderation_audit(actor_identity_id,action,details)
         VALUES($1,'topic_moderated',jsonb_build_object('topicId',$2::uuid,'locked',$3::boolean,'pinned',$4::boolean,'category',$5::text))`,
        [viewer.identity_id, topicId, locked ?? null, pinned ?? null, category ?? null]
      );
      await client.query('COMMIT');
      return result.rowCount === 1;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async updateDefect(defectId, changes, viewer) {
    if (viewer?.is_moderator !== true) return false;
    const result = await this.pool.query(
      `UPDATE defects SET status=COALESCE($2,status), target_release=COALESCE($3,target_release),
         related_change=COALESCE($4,related_change), duplicate_of=COALESCE($5,duplicate_of), updated_at=now()
       WHERE id=$1 RETURNING topic_id`,
      [defectId, changes.status ?? null, changes.targetRelease ?? null, changes.relatedChange ?? null, changes.duplicateOf ?? null]
    );
    if (!result.rowCount) return false;
    await this.pool.query('UPDATE forum_topics SET updated_at=now() WHERE id=$1', [result.rows[0].topic_id]);
    await this.pool.query(
      `INSERT INTO moderation_audit(actor_identity_id,action,details)
       VALUES($1,'defect_updated',jsonb_build_object('defectId',$2::uuid,'changes',$3::jsonb))`,
      [viewer.identity_id, defectId, JSON.stringify(changes)]
    );
    return true;
  }

  async listReports(viewer) {
    if (viewer?.is_moderator !== true) return null;
    const result = await this.pool.query(
      `SELECT r.id,r.topic_id,r.post_id,r.reason,r.status,r.created_at,i.fingerprint AS reporter_fingerprint
       FROM forum_reports r LEFT JOIN identities i ON i.id=r.reporter_identity_id
       ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END,r.created_at DESC LIMIT 100`
    );
    return result.rows;
  }

  async updateReport(reportId, status, viewer) {
    if (viewer?.is_moderator !== true) return false;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `UPDATE forum_reports SET status=$2, resolved_at=CASE WHEN $2 IN ('resolved','dismissed') THEN now() ELSE NULL END
         WHERE id=$1 RETURNING id`, [reportId, status]
      );
      if (result.rowCount) await client.query(
        `INSERT INTO moderation_audit(actor_identity_id,action,details)
         VALUES($1,'report_updated',jsonb_build_object('reportId',$2::uuid,'status',$3::text))`,
        [viewer.identity_id, reportId, status]
      );
      await client.query('COMMIT');
      return result.rowCount === 1;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async restoreTopic(topicId, viewer) {
    if (viewer?.is_moderator !== true) return false;
    const result = await this.pool.query(
      `UPDATE forum_topics SET deleted_at=NULL,purge_after=NULL,updated_at=now()
       WHERE id=$1 AND deleted_at IS NOT NULL AND purge_after>now() RETURNING id`, [topicId]
    );
    if (result.rowCount) await this.pool.query(
      `INSERT INTO moderation_audit(actor_identity_id,action,details)
       VALUES($1,'topic_restored',jsonb_build_object('topicId',$2::uuid))`, [viewer.identity_id, topicId]
    );
    return result.rowCount === 1;
  }

  async restoreReply(postId, viewer) {
    if (viewer?.is_moderator !== true) return false;
    const result = await this.pool.query(
      `UPDATE forum_posts SET deleted_at=NULL,purge_after=NULL,updated_at=now()
       WHERE id=$1 AND deleted_at IS NOT NULL AND purge_after>now() RETURNING id`, [postId]
    );
    if (result.rowCount) await this.pool.query(
      `INSERT INTO moderation_audit(actor_identity_id,action,details)
       VALUES($1,'post_restored',jsonb_build_object('postId',$2::uuid))`, [viewer.identity_id, postId]
    );
    return result.rowCount === 1;
  }

  async activeSanctions(viewer) {
    if (!viewer?.identity_id) return [];
    const result = await this.pool.query(
      `SELECT id,kind,reason,created_at,expires_at FROM identity_sanctions
       WHERE identity_id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>now()) ORDER BY created_at DESC`,
      [viewer.identity_id]
    );
    return result.rows;
  }

  async sanctionTopicAuthor(topicId, { kind, reason, expiresAt = null }, viewer) {
    if (viewer?.is_moderator !== true) return null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO identity_sanctions(identity_id,actor_identity_id,kind,reason,expires_at)
         SELECT author_identity_id,$2,$3,$4,$5 FROM forum_topics
         WHERE id=$1 AND author_identity_id IS NOT NULL AND author_identity_id<>$2 RETURNING id`,
        [topicId, viewer.identity_id, kind, reason, expiresAt]
      );
      if (result.rowCount) await client.query(
        `INSERT INTO moderation_audit(actor_identity_id,target_identity_id,action,details)
         SELECT $1,identity_id,'sanction_created',jsonb_build_object('sanctionId',$2::uuid,'kind',$3::text,'topicId',$4::uuid)
         FROM identity_sanctions WHERE id=$2`, [viewer.identity_id, result.rows[0].id, kind, topicId]
      );
      await client.query('COMMIT');
      return result.rows[0] ?? null;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  async revokeSanction(sanctionId, viewer) {
    if (viewer?.is_moderator !== true) return false;
    const result = await this.pool.query(
      `UPDATE identity_sanctions SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL RETURNING identity_id`, [sanctionId]
    );
    if (result.rowCount) await this.pool.query(
      `INSERT INTO moderation_audit(actor_identity_id,target_identity_id,action,details)
       VALUES($1,$2,'sanction_revoked',jsonb_build_object('sanctionId',$3::uuid))`,
      [viewer.identity_id, result.rows[0].identity_id, sanctionId]
    );
    return result.rowCount === 1;
  }

  async moderationOverview(viewer) {
    if (viewer?.is_moderator !== true) return null;
    const [reports, sanctions, audit, deletedTopics, deletedPosts] = await Promise.all([
      this.listReports(viewer),
      this.pool.query(`SELECT s.id,s.kind,s.reason,s.created_at,s.expires_at,s.revoked_at,i.fingerprint
        FROM identity_sanctions s JOIN identities i ON i.id=s.identity_id ORDER BY s.created_at DESC LIMIT 100`),
      this.pool.query(`SELECT id,action,details,created_at,expires_at FROM moderation_audit ORDER BY created_at DESC LIMIT 100`),
      this.pool.query(`SELECT id,title,category_slug,deleted_at,purge_after FROM forum_topics WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 100`),
      this.pool.query(`SELECT p.id,p.topic_id,p.deleted_at,p.purge_after FROM forum_posts p WHERE p.deleted_at IS NOT NULL ORDER BY p.deleted_at DESC LIMIT 100`)
    ]);
    return { reports, sanctions: sanctions.rows, audit: audit.rows, deletedTopics: deletedTopics.rows, deletedPosts: deletedPosts.rows };
  }
}

const DEFAULT_CATEGORIES = [
  ['announcements','Announcements','Service announcements and important community notices.','public'],
  ['releases','Releases','Release notes, checksums, compatibility notes, and upgrade help.','public'],
  ['installation-help','Installation Help','Public installation, recovery, and connection guidance.','public'],
  ['service-status','Service Status','Public incidents, maintenance, and service restoration updates.','public'],
  ['beta-testing','Beta Testing','Paired-player testing feedback and compatibility discussion.','paired'],
  ['bugs-defects','Bugs and Defects','Structured defect reports and linked investigation discussion.','paired'],
  ['development-code','Development and Code','Implementation, protocol, testing, and code discussion.','paired'],
  ['feature-ideas','Feature Ideas','Focused proposals for improving Emerald Online 3DS.','paired'],
  ['multiplayer-help','Multiplayer Help','Troubleshooting presence, chat, and future link sessions.','paired'],
  ['general','General Discussion','Paired-player community conversation.','paired'],
  ['moderation','Moderation','Private reports and moderation coordination.','moderator']
].map(([slug,name,description,visibility], position) => ({ slug,name,description,visibility,position: (position + 1) * 10 }));

export class MemoryCommunityStore {
  constructor() { this.topics = new Map(); this.posts = new Map(); this.subscriptions = new Set(); this.reports = []; this.sanctions = []; this.audit = []; this.categoriesData = structuredClone(DEFAULT_CATEGORIES); }
  canWrite(viewer){return viewer?.is_moderator||!this.sanctions.some(s=>s.identity_id===viewer?.identity_id&&!s.revoked_at&&(!s.expires_at||s.expires_at>Date.now())&&['read-only','suspended'].includes(s.kind));}
  canRead(topic, viewer) { const category = this.categoriesData.find(item => item.slug === topic.category_slug); return category?.visibility === 'public' || (viewer?.identity_id && category?.visibility === 'paired') || viewer?.is_moderator || (topic.defect && PUBLIC_DEFECT_STATES.has(topic.defect.status)); }
  async categories(viewer) { return this.categoriesData.map(category => ({ ...category, readable: category.visibility === 'public' || category.slug === 'bugs-defects' || (viewer?.identity_id && category.visibility === 'paired') || viewer?.is_moderator })); }
  async listTopics({ category=null, query='', page=1, pageSize=20, viewer=null }={}) { const bounds=pageBounds(page,pageSize), q=query.toLowerCase(); const rows=[...this.topics.values()].filter(t=>!t.deleted_at&&(!category||t.category_slug===category)&&(!q||`${t.title} ${t.body_markdown}`.toLowerCase().includes(q))&&this.canRead(t,viewer)).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||b.updated_at-a.updated_at).slice(bounds.offset,bounds.offset+bounds.pageSize).map(t=>({ ...t, reply_count:[...this.posts.values()].filter(p=>p.topic_id===t.id&&!p.deleted_at).length, defect_id:t.defect?.id, severity:t.defect?.severity, defect_status:t.defect?.status })); return {...bounds,topics:rows}; }
  async getTopic(id,viewer) { const t=this.topics.get(id); if(!t||(!this.canRead(t,viewer))||(t.deleted_at&&!viewer?.is_moderator))return null; return {...t, defect_id:t.defect?.id, ...(t.defect??{}), defect_status:t.defect?.status, subscribed:this.subscriptions.has(`${viewer?.identity_id}:${id}`), posts:[...this.posts.values()].filter(p=>p.topic_id===id&&(!p.deleted_at||viewer?.is_moderator)).sort((a,b)=>a.created_at-b.created_at)}; }
  async createTopic({category,title,body,defect=null},viewer){if(!viewer?.identity_id||!this.canWrite(viewer))return null;const c=this.categoriesData.find(x=>x.slug===category),staffOnly=['announcements','releases','service-status'].includes(category);if(!c||(c.visibility==='moderator'&&!viewer.is_moderator)||(staffOnly&&!viewer.is_moderator)||(category==='bugs-defects')!==Boolean(defect))return null;const now=Date.now(),id=crypto.randomUUID();this.topics.set(id,{id,category_slug:category,category_name:c.name,author_identity_id:viewer.identity_id,author_fingerprint:viewer.fingerprint,title,body_markdown:body,pinned:false,locked:false,created_at:now,updated_at:now,deleted_at:null,defect:defect?{id:crypto.randomUUID(),status:'new',severity:defect.severity,reproduction_steps:defect.reproductionSteps,expected_behavior:defect.expectedBehavior,actual_behavior:defect.actualBehavior,runtime_version:defect.runtimeVersion,artifact_hash:defect.artifactHash,console_model:defect.consoleModel,install_method:defect.installMethod,transport:defect.transport,diagnostic_text:defect.diagnosticText,target_release:null,related_change:null,duplicate_of:null}:null});this.subscriptions.add(`${viewer.identity_id}:${id}`);return{id};}
  async updateTopic(id,{title,body},viewer){const t=this.topics.get(id);if(!t||!this.canWrite(viewer)||(t.author_identity_id!==viewer?.identity_id&&!viewer?.is_moderator))return false;if(title)t.title=title;if(body)t.body_markdown=body;t.updated_at=Date.now();return true;}
  async deleteTopic(id,viewer){const t=this.topics.get(id);if(!t||(t.author_identity_id!==viewer?.identity_id&&!viewer?.is_moderator))return false;t.deleted_at=Date.now();return true;}
  async createReply(topicId,body,viewer){const t=this.topics.get(topicId);if(!viewer?.identity_id||!this.canWrite(viewer)||!t||!this.canRead(t,viewer)||(t.locked&&!viewer.is_moderator))return null;const id=crypto.randomUUID();this.posts.set(id,{id,topic_id:topicId,author_identity_id:viewer.identity_id,author_fingerprint:viewer.fingerprint,body_markdown:body,created_at:Date.now(),updated_at:Date.now(),deleted_at:null});t.updated_at=Date.now();return{id};}
  async updateReply(id,body,viewer){const p=this.posts.get(id),t=p&&this.topics.get(p.topic_id);if(!p||!t||!this.canWrite(viewer)||(t.locked&&!viewer?.is_moderator)||(p.author_identity_id!==viewer?.identity_id&&!viewer?.is_moderator))return false;p.body_markdown=body;p.updated_at=Date.now();return true;}
  async deleteReply(id,viewer){const p=this.posts.get(id);if(!p||(p.author_identity_id!==viewer?.identity_id&&!viewer?.is_moderator))return false;p.deleted_at=Date.now();return true;}
  async setSubscription(id,on,viewer){if(!viewer?.identity_id)return false;const key=`${viewer.identity_id}:${id}`;if(on)this.subscriptions.add(key);else this.subscriptions.delete(key);return true;}
  async report({topicId=null,postId=null,reason},viewer){if(!viewer?.identity_id)return null;const post=postId?this.posts.get(postId):null,topic=this.topics.get(topicId??post?.topic_id);if(!topic||!this.canRead(topic,viewer)||topic.deleted_at||post?.deleted_at)return null;const row={id:crypto.randomUUID(),topic_id:topicId,post_id:postId,reason,status:'open',created_at:Date.now(),reporter_fingerprint:viewer.fingerprint};this.reports.push(row);return{id:row.id};}
  async moderateTopic(id,changes,viewer){const t=this.topics.get(id);if(!t||!viewer?.is_moderator)return false;if(changes.locked!==undefined)t.locked=changes.locked;if(changes.pinned!==undefined)t.pinned=changes.pinned;if(changes.category)t.category_slug=changes.category;t.updated_at=Date.now();return true;}
  async updateDefect(id,changes,viewer){if(!viewer?.is_moderator)return false;const t=[...this.topics.values()].find(x=>x.defect?.id===id);if(!t)return false;Object.assign(t.defect,changes);t.updated_at=Date.now();return true;}
  async listReports(viewer){return viewer?.is_moderator?[...this.reports]:null;}
  async updateReport(id,status,viewer){if(!viewer?.is_moderator)return false;const row=this.reports.find(x=>x.id===id);if(!row)return false;row.status=status;row.resolved_at=['resolved','dismissed'].includes(status)?Date.now():null;return true;}
  async restoreTopic(id,viewer){const t=this.topics.get(id);if(!t?.deleted_at||!viewer?.is_moderator)return false;t.deleted_at=null;t.updated_at=Date.now();return true;}
  async restoreReply(id,viewer){const p=this.posts.get(id);if(!p?.deleted_at||!viewer?.is_moderator)return false;p.deleted_at=null;p.updated_at=Date.now();return true;}
  async activeSanctions(viewer){return this.sanctions.filter(s=>s.identity_id===viewer?.identity_id&&!s.revoked_at&&(!s.expires_at||s.expires_at>Date.now())).map(({identity_id,...s})=>s);}
  async sanctionTopicAuthor(id,{kind,reason,expiresAt=null},viewer){const t=this.topics.get(id);if(!t?.author_identity_id||!viewer?.is_moderator||t.author_identity_id===viewer.identity_id)return null;const row={id:crypto.randomUUID(),identity_id:t.author_identity_id,fingerprint:t.author_fingerprint,kind,reason,created_at:Date.now(),expires_at:expiresAt?new Date(expiresAt).getTime():null,revoked_at:null};this.sanctions.push(row);this.audit.push({action:'sanction_created',created_at:Date.now()});return{id:row.id};}
  async revokeSanction(id,viewer){const row=this.sanctions.find(x=>x.id===id);if(!row||row.revoked_at||!viewer?.is_moderator)return false;row.revoked_at=Date.now();return true;}
  async moderationOverview(viewer){if(!viewer?.is_moderator)return null;return{reports:[...this.reports],sanctions:this.sanctions.map(({identity_id,...s})=>s),audit:[...this.audit],deletedTopics:[...this.topics.values()].filter(x=>x.deleted_at).map(({author_identity_id,...t})=>t),deletedPosts:[...this.posts.values()].filter(x=>x.deleted_at).map(({author_identity_id,...p})=>p)};}
}
