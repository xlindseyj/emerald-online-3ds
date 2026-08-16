import crypto from 'node:crypto';
import { renderMarkdown } from '../server/src/markdown.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PAIRING = /^[A-Z2-9]{4}-[A-Z2-9]{4}$/;
const TOKEN = /^[a-f0-9]{64}$/i;
const CATEGORY = /^[a-z0-9-]{2,40}$/;
const HASH = /^[a-f0-9]{64}$/;
const SEVERITIES = new Set(['low', 'medium', 'high', 'critical']);
const MODELS = new Set(['old-3ds', 'old-3ds-xl', 'new-3ds', 'new-3ds-xl', 'new-2ds-xl', 'emulator']);
const INSTALLS = new Set(['cia', '3dsx']);
const TRANSPORTS = new Set(['wss', 'tcp']);
const DEFECT_STATES = new Set(['new', 'needs-information', 'confirmed', 'in-progress', 'needs-retest', 'fixed', 'closed']);
const COMPATIBILITY_RESULTS = new Set(['pass','fail','partial']);
const COOKIE = 'emerald_session';
const BOARD = new Set(['pokedex-seen','pokedex-caught','badges','frontier-streak','online-battles','online-trades','beta-compatibility']);
const RELEASE = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][a-z0-9.-]+)?$/i;
const VARIANT = /^[a-z0-9:-]{0,80}$/;
const PUBLICATION_KEY = /^[a-z0-9][a-z0-9-]{2,79}$/;

function headers(extra = {}) {
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    ...extra
  };
}

function send(res, status, body, extra = {}) {
  res.writeHead(status, headers(extra));
  res.end(JSON.stringify(body));
}

function cookies(req) {
  const result = new Map();
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index > 0) result.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return result;
}

async function jsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32768) { const error = new Error('request_too_large'); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const error = new Error('invalid_json'); error.status = 400; throw error; }
}

function bounded(value, minimum, maximum) {
  return typeof value === 'string' && value.trim().length >= minimum && value.trim().length <= maximum ? value.trim() : null;
}

function timingEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  return crypto.timingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function serializeTopic(topic) {
  if (!topic) return null;
  const { author_identity_id: _authorIdentityId, ...safeTopic } = topic;
  return {
    ...safeTopic,
    body_html: topic.body_markdown ? renderMarkdown(topic.body_markdown) : '',
    posts: topic.posts?.map(post => {
      const { author_identity_id: _postAuthorIdentityId, ...safePost } = post;
      return { ...safePost, body_html: post.deleted_at ? '' : renderMarkdown(post.body_markdown) };
    })
  };
}

function validateDefect(value) {
  if (!value || typeof value !== 'object' || !SEVERITIES.has(value.severity) || !HASH.test(value.artifactHash ?? '') ||
      !MODELS.has(value.consoleModel) || !INSTALLS.has(value.installMethod) || !TRANSPORTS.has(value.transport)) return null;
  const reproductionSteps = bounded(value.reproductionSteps, 1, 10000);
  const expectedBehavior = bounded(value.expectedBehavior, 1, 5000);
  const actualBehavior = bounded(value.actualBehavior, 1, 5000);
  const runtimeVersion = bounded(value.runtimeVersion, 1, 40);
  const diagnosticText = typeof value.diagnosticText === 'string' && value.diagnosticText.length <= 10000 ? value.diagnosticText.trim() : null;
  if (!reproductionSteps || !expectedBehavior || !actualBehavior || !runtimeVersion || diagnosticText === null) return null;
  return { severity: value.severity, reproductionSteps, expectedBehavior, actualBehavior, runtimeVersion,
    artifactHash: value.artifactHash, consoleModel: value.consoleModel, installMethod: value.installMethod,
    transport: value.transport, diagnosticText };
}

function requestIp(req) {
  return String(req.headers['cf-connecting-ip'] ?? req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'unknown').split(',')[0].trim();
}

export function createCommunityApp({ identityStore, communityStore, statsStore = null, secureCookies = true, page = '' }) {
  if (!identityStore || !communityStore) throw new Error('identity and community stores are required');
  const pairingStarts = new Map();
  const writeBuckets = new Map();
  const sessionCookie = token => `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secureCookies ? '; Secure' : ''}`;
  const clearCookie = `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookies ? '; Secure' : ''}`;

  async function viewer(req) {
    const token = cookies(req).get(COOKIE);
    return TOKEN.test(token ?? '') ? { token, session: await identityStore.authenticateBrowserSession(token) } : { token: null, session: null };
  }

  function requireCsrf(req, auth) {
    return auth.session && timingEqual(req.headers['x-csrf-token'], auth.session.csrf_token);
  }

  function consumeLimit(identityId, scope, maximum, windowMs) {
    const key = `${identityId}:${scope}`, now = Date.now();
    const recent = (writeBuckets.get(key) ?? []).filter(time => time > now - windowMs);
    if (recent.length >= maximum) return false;
    recent.push(now);
    writeBuckets.set(key, recent);
    return true;
  }

  function rateLimited(res, auth, scope, maximum, windowMs) {
    if (auth.session?.is_moderator || consumeLimit(auth.session.identity_id, scope, maximum, windowMs)) return false;
    send(res, 429, { ok: false, error: 'community_rate_limited' }, { 'retry-after': String(Math.ceil(windowMs / 1000)) });
    return true;
  }

  return async function handleCommunity(req, res, url = new URL(req.url ?? '/', 'http://localhost')) {
    const { pathname } = url;
    if (pathname === '/community' || pathname === '/community/') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
        'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
        'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY'
      });
      res.end(page);
      return true;
    }
    if (!pathname.startsWith('/api/community/')) return false;

    try {
      if (pathname === '/api/community/pairing/start' && req.method === 'POST') {
        const ipKey = crypto.createHash('sha256').update(requestIp(req)).digest('hex');
        const recent = (pairingStarts.get(ipKey) ?? []).filter(time => time > Date.now() - 3600000);
        if (recent.length >= 10) return send(res, 429, { ok: false, error: 'pairing_rate_limited' }, { 'retry-after': '3600' }), true;
        recent.push(Date.now()); pairingStarts.set(ipKey, recent);
        const started = await identityStore.startPairing();
        send(res, 201, { ok: true, code: started.code, requestToken: started.requestToken, expiresAt: started.expiresAt });
        return true;
      }
      if (pathname === '/api/community/pairing/consume' && req.method === 'POST') {
        const body = await jsonBody(req);
        const code = String(body.code ?? '').toUpperCase();
        if (!PAIRING.test(code) || !TOKEN.test(body.requestToken ?? '')) return send(res, 400, { ok: false, error: 'invalid_pairing_request' }), true;
        const paired = await identityStore.consumePairing(code, body.requestToken);
        if (!paired) return send(res, 409, { ok: false, error: 'pairing_pending_or_expired' }), true;
        send(res, 200, { ok: true, fingerprint: paired.fingerprint, csrfToken: paired.csrfToken }, { 'set-cookie': sessionCookie(paired.token) });
        return true;
      }

      const auth = await viewer(req);
      if (auth.session && requireCsrf(req, auth) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
          rateLimited(res, auth, 'all-writes', 60, 60000)) return true;
      if (pathname === '/api/community/session' && req.method === 'GET') {
        const sanctions = auth.session ? await communityStore.activeSanctions(auth.session) : [];
        send(res, 200, { ok: true, paired: Boolean(auth.session), ...(auth.session ? { fingerprint: auth.session.fingerprint, moderator: auth.session.is_moderator, csrfToken: auth.session.csrf_token, sanctions } : {}) });
        return true;
      }
      if (pathname === '/api/community/session/logout' && req.method === 'POST') {
        if (!auth.session || !requireCsrf(req, auth)) return send(res, 403, { ok: false, error: 'csrf_or_session_required' }), true;
        await identityStore.revokeBrowserSession(auth.token);
        send(res, 200, { ok: true }, { 'set-cookie': clearCookie });
        return true;
      }
      const publicationMatch = pathname.match(/^\/api\/community\/publications\/([a-z0-9][a-z0-9-]{2,79})$/);
      if (publicationMatch && req.method === 'GET') {
        if (!PUBLICATION_KEY.test(publicationMatch[1])) return send(res, 400, { ok: false, error: 'invalid_publication_key' }), true;
        const publication = await communityStore.getOfficialCommunityPublication(publicationMatch[1], auth.session);
        if (!publication) return send(res, 404, { ok: false, error: 'publication_not_found' }), true;
        send(res, 200, { ok: true, topic: serializeTopic(publication) });
        return true;
      }
      if (pathname === '/api/community/profile' && req.method === 'GET') {
        if (!auth.session || !statsStore) return send(res, 403, { ok: false, error: 'paired_session_required' }), true;
        send(res, 200, { ok: true, fingerprint: auth.session.fingerprint, stats: await statsStore.profile(auth.session.identity_id) });
        return true;
      }
      if (pathname === '/api/community/leaderboards' && req.method === 'GET') {
        if (!auth.session || !statsStore) return send(res, 403, { ok: false, error: 'paired_session_required' }), true;
        const board = url.searchParams.get('board') ?? 'pokedex-caught';
        const release = url.searchParams.get('release') ?? '0.6.0';
        const variant = url.searchParams.get('variant') ?? '';
        const pageNumber = Number(url.searchParams.get('page') ?? 1);
        if (!BOARD.has(board) || !RELEASE.test(release) || !VARIANT.test(variant) || !Number.isSafeInteger(pageNumber) || pageNumber < 1) return send(res, 400, { ok: false, error: 'invalid_leaderboard_query' }), true;
        const result = await statsStore.listBoards({ board, release, variant, page: pageNumber });
        if (!result) return send(res, 404, { ok: false, error: 'leaderboard_not_found' }), true;
        send(res, 200, { ok: true, ...result });
        return true;
      }
      if (pathname === '/api/community/compatibility-reports' && req.method === 'POST') {
        if (!auth.session || !statsStore || !requireCsrf(req,auth)) return send(res,403,{ok:false,error:'csrf_or_session_required'}),true;
        if(rateLimited(res,auth,'compatibility-reports',12,3600000))return true;
        const body=await jsonBody(req),notes=typeof body.notes==='string'&&body.notes.length<=1000?body.notes.trim():null;
        if(!RELEASE.test(body.release??'')||!HASH.test(body.artifactHash??'')||!MODELS.has(body.consoleModel)||!INSTALLS.has(body.installMethod)||!TRANSPORTS.has(body.transport)||!COMPATIBILITY_RESULTS.has(body.result)||notes===null)return send(res,400,{ok:false,error:'invalid_compatibility_report'}),true;
        const created=await statsStore.reportCompatibility(auth.session.identity_id,{release:body.release,artifactHash:body.artifactHash,consoleModel:body.consoleModel,installMethod:body.installMethod,transport:body.transport,result:body.result,notes});
        send(res,201,{ok:true,id:created.id});return true;
      }
      if (pathname === '/api/community/stats' && req.method === 'DELETE') {
        if (!auth.session || !statsStore || !requireCsrf(req, auth)) return send(res, 403, { ok: false, error: 'csrf_or_session_required' }), true;
        const body = await jsonBody(req);
        if (body.confirm !== 'DELETE ALL STATS') return send(res, 400, { ok: false, error: 'stats_deletion_confirmation_required' }), true;
        await statsStore.deleteIdentityStats(auth.session.identity_id);
        send(res, 200, { ok: true, deleted: true });
        return true;
      }
      if (pathname === '/api/community/moderation/stats' && req.method === 'GET') {
        if (!auth.session?.is_moderator || !statsStore) return send(res, 403, { ok: false, error: 'moderator_required' }), true;
        send(res, 200, { ok: true, entries: await statsStore.listUnderReview() }); return true;
      }
      const statsReview = pathname.match(/^\/api\/community\/moderation\/stats\/([0-9a-f-]{36})$/i);
      if (statsReview && req.method === 'PATCH') {
        if (!auth.session?.is_moderator || !statsStore || !requireCsrf(req, auth)) return send(res, 403, { ok: false, error: 'moderator_required' }), true;
        const decision=(await jsonBody(req)).decision;
        if(!['accept','dismiss'].includes(decision)) return send(res,400,{ok:false,error:'invalid_stats_review'}),true;
        send(res,200,{ok:await statsStore.resolveReview(statsReview[1],decision,auth.session.identity_id)});return true;
      }
      if (pathname === '/api/community/categories' && req.method === 'GET') {
        send(res, 200, { ok: true, categories: await communityStore.categories(auth.session) });
        return true;
      }
      if (pathname === '/api/community/topics' && req.method === 'GET') {
        const pageNumber = Number(url.searchParams.get('page') ?? 1);
        const category = url.searchParams.get('category');
        if (category && !CATEGORY.test(category)) return send(res, 400, { ok: false, error: 'invalid_category' }), true;
        const result = await communityStore.listTopics({ category, query: url.searchParams.get('q') ?? '', page: pageNumber, viewer: auth.session });
        send(res, 200, { ok: true, ...result });
        return true;
      }
      if (pathname === '/api/community/topics' && req.method === 'POST') {
        if (!auth.session || !requireCsrf(req, auth)) return send(res, 403, { ok: false, error: 'csrf_or_session_required' }), true;
        if (rateLimited(res, auth, 'new-topics', 5, 3600000)) return true;
        const body = await jsonBody(req), category = CATEGORY.test(body.category ?? '') ? body.category : null;
        const title = bounded(body.title, 3, 120), markdown = bounded(body.body, 1, 10000);
        const defect = category === 'bugs-defects' ? validateDefect(body.defect) : null;
        if (!category || !title || !markdown || (category === 'bugs-defects' && !defect) || (category !== 'bugs-defects' && body.defect)) return send(res, 400, { ok: false, error: 'invalid_topic' }), true;
        const created = await communityStore.createTopic({ category, title, body: markdown, defect }, auth.session);
        if (!created) return send(res, 403, { ok: false, error: 'category_not_writable' }), true;
        send(res, 201, { ok: true, ...created });
        return true;
      }

      const topicMatch = pathname.match(/^\/api\/community\/topics\/([0-9a-f-]{36})$/i);
      if (topicMatch && !UUID.test(topicMatch[1])) return send(res, 400, { ok: false, error: 'invalid_topic_id' }), true;
      if (topicMatch && req.method === 'GET') {
        const topic = await communityStore.getTopic(topicMatch[1], auth.session);
        if (!topic) return send(res, 404, { ok: false, error: 'topic_not_found' }), true;
        send(res, 200, { ok: true, topic: serializeTopic(topic) });
        return true;
      }
      if (topicMatch && (req.method === 'PATCH' || req.method === 'DELETE')) {
        if (!auth.session || !requireCsrf(req, auth)) return send(res, 403, { ok: false, error: 'csrf_or_session_required' }), true;
        let updated;
        if (req.method === 'DELETE') updated = await communityStore.deleteTopic(topicMatch[1], auth.session);
        else {
          const body = await jsonBody(req);
          const title = body.title === undefined ? undefined : bounded(body.title, 3, 120);
          const markdown = body.body === undefined ? undefined : bounded(body.body, 1, 10000);
          if ((body.title !== undefined && !title) || (body.body !== undefined && !markdown) || (title === undefined && markdown === undefined)) return send(res, 400, { ok: false, error: 'invalid_topic' }), true;
          updated = await communityStore.updateTopic(topicMatch[1], { title, body: markdown }, auth.session);
        }
        send(res, updated ? 200 : 403, { ok: updated });
        return true;
      }

      const replyCreate = pathname.match(/^\/api\/community\/topics\/([0-9a-f-]{36})\/replies$/i);
      if (replyCreate && UUID.test(replyCreate[1]) && req.method === 'POST') {
        if (!auth.session || !requireCsrf(req, auth)) return send(res, 403, { ok: false, error: 'csrf_or_session_required' }), true;
        const body = await jsonBody(req), markdown = bounded(body.body, 1, 10000);
        if (!markdown) return send(res, 400, { ok: false, error: 'invalid_reply' }), true;
        const created = await communityStore.createReply(replyCreate[1], markdown, auth.session);
        send(res, created ? 201 : 403, { ok: Boolean(created), ...(created ?? {}) });
        return true;
      }
      const postMatch = pathname.match(/^\/api\/community\/posts\/([0-9a-f-]{36})$/i);
      if (postMatch && UUID.test(postMatch[1]) && (req.method === 'PATCH' || req.method === 'DELETE')) {
        if (!auth.session || !requireCsrf(req, auth)) return send(res, 403, { ok: false, error: 'csrf_or_session_required' }), true;
        let updated;
        if (req.method === 'DELETE') updated = await communityStore.deleteReply(postMatch[1], auth.session);
        else {
          const markdown = bounded((await jsonBody(req)).body, 1, 10000);
          if (!markdown) return send(res, 400, { ok: false, error: 'invalid_reply' }), true;
          updated = await communityStore.updateReply(postMatch[1], markdown, auth.session);
        }
        send(res, updated ? 200 : 403, { ok: updated });
        return true;
      }
      const subscription = pathname.match(/^\/api\/community\/topics\/([0-9a-f-]{36})\/subscription$/i);
      if (subscription && UUID.test(subscription[1]) && req.method === 'PUT') {
        if (!auth.session || !requireCsrf(req, auth)) return send(res, 403, { ok: false, error: 'csrf_or_session_required' }), true;
        const body = await jsonBody(req);
        if (typeof body.subscribed !== 'boolean') return send(res, 400, { ok: false, error: 'invalid_subscription' }), true;
        send(res, 200, { ok: await communityStore.setSubscription(subscription[1], body.subscribed, auth.session) });
        return true;
      }
      if (pathname === '/api/community/reports' && req.method === 'POST') {
        if (!auth.session || !requireCsrf(req, auth)) return send(res, 403, { ok: false, error: 'csrf_or_session_required' }), true;
        if (rateLimited(res, auth, 'reports', 10, 3600000)) return true;
        const body = await jsonBody(req), reason = bounded(body.reason, 3, 1000);
        const topicId = UUID.test(body.topicId ?? '') ? body.topicId : null, postId = UUID.test(body.postId ?? '') ? body.postId : null;
        if (!reason || Boolean(topicId) === Boolean(postId)) return send(res, 400, { ok: false, error: 'invalid_report' }), true;
        const created = await communityStore.report({ topicId, postId, reason }, auth.session);
        send(res, created ? 201 : 403, { ok: Boolean(created), ...(created ?? {}) });
        return true;
      }
      if (pathname === '/api/community/reports' && req.method === 'GET') {
        const reports = await communityStore.listReports(auth.session);
        if (!reports) return send(res, 403, { ok: false, error: 'moderator_required' }), true;
        send(res, 200, { ok: true, reports }); return true;
      }
      const moderation = pathname.match(/^\/api\/community\/moderation\/topics\/([0-9a-f-]{36})$/i);
      if (moderation && UUID.test(moderation[1]) && req.method === 'PATCH') {
        if (!auth.session?.is_moderator || !requireCsrf(req, auth)) return send(res, 403, { ok: false, error: 'moderator_required' }), true;
        const body = await jsonBody(req), changes = {};
        if (typeof body.locked === 'boolean') changes.locked = body.locked;
        if (typeof body.pinned === 'boolean') changes.pinned = body.pinned;
        if (CATEGORY.test(body.category ?? '')) changes.category = body.category;
        if (!Object.keys(changes).length) return send(res, 400, { ok: false, error: 'invalid_moderation' }), true;
        send(res, 200, { ok: await communityStore.moderateTopic(moderation[1], changes, auth.session) }); return true;
      }
      const defectMatch = pathname.match(/^\/api\/community\/moderation\/defects\/([0-9a-f-]{36})$/i);
      if (defectMatch && UUID.test(defectMatch[1]) && req.method === 'PATCH') {
        if (!auth.session?.is_moderator || !requireCsrf(req, auth)) return send(res, 403, { ok: false, error: 'moderator_required' }), true;
        const body = await jsonBody(req), changes = {};
        if (DEFECT_STATES.has(body.status)) changes.status = body.status;
        if (body.targetRelease === null || bounded(body.targetRelease, 1, 40)) changes.targetRelease = body.targetRelease;
        if (body.relatedChange === null || bounded(body.relatedChange, 1, 240)) changes.relatedChange = body.relatedChange;
        if (body.duplicateOf === null || UUID.test(body.duplicateOf ?? '')) changes.duplicateOf = body.duplicateOf;
        if (!Object.keys(changes).length) return send(res, 400, { ok: false, error: 'invalid_defect_update' }), true;
        send(res, 200, { ok: await communityStore.updateDefect(defectMatch[1], changes, auth.session) }); return true;
      }
      const reportMatch = pathname.match(/^\/api\/community\/moderation\/reports\/([0-9a-f-]{36})$/i);
      if (reportMatch && UUID.test(reportMatch[1]) && req.method === 'PATCH') {
        if (!auth.session?.is_moderator || !requireCsrf(req, auth)) return send(res, 403, { ok: false, error: 'moderator_required' }), true;
        const status = (await jsonBody(req)).status;
        if (!['open', 'reviewing', 'resolved', 'dismissed'].includes(status)) return send(res, 400, { ok: false, error: 'invalid_report_status' }), true;
        send(res, 200, { ok: await communityStore.updateReport(reportMatch[1], status, auth.session) }); return true;
      }
      if (pathname === '/api/community/moderation/overview' && req.method === 'GET') {
        const overview = await communityStore.moderationOverview(auth.session);
        if (!overview) return send(res, 403, { ok: false, error: 'moderator_required' }), true;
        send(res, 200, { ok: true, ...overview }); return true;
      }
      if (pathname === '/api/community/moderation/sanctions' && req.method === 'POST') {
        if (!auth.session?.is_moderator || !requireCsrf(req, auth)) return send(res, 403, { ok: false, error: 'moderator_required' }), true;
        const body = await jsonBody(req), topicId = UUID.test(body.topicId ?? '') ? body.topicId : null;
        const kind = ['warning', 'read-only', 'suspended'].includes(body.kind) ? body.kind : null;
        const reason = bounded(body.reason, 3, 1000);
        let expiresAt = null;
        if (body.expiresAt !== undefined && body.expiresAt !== null) {
          const parsed = Date.parse(body.expiresAt);
          if (!Number.isFinite(parsed) || parsed <= Date.now() || parsed > Date.now() + 366 * 86400000) return send(res, 400, { ok: false, error: 'invalid_sanction_expiry' }), true;
          expiresAt = new Date(parsed).toISOString();
        }
        if (!topicId || !kind || !reason) return send(res, 400, { ok: false, error: 'invalid_sanction' }), true;
        const created = await communityStore.sanctionTopicAuthor(topicId, { kind, reason, expiresAt }, auth.session);
        send(res, created ? 201 : 404, { ok: Boolean(created), ...(created ?? {}) }); return true;
      }
      const sanctionMatch = pathname.match(/^\/api\/community\/moderation\/sanctions\/([0-9a-f-]{36})$/i);
      if (sanctionMatch && UUID.test(sanctionMatch[1]) && req.method === 'DELETE') {
        if (!auth.session?.is_moderator || !requireCsrf(req, auth)) return send(res, 403, { ok: false, error: 'moderator_required' }), true;
        send(res, 200, { ok: await communityStore.revokeSanction(sanctionMatch[1], auth.session) }); return true;
      }
      const restoreMatch = pathname.match(/^\/api\/community\/moderation\/(topics|posts)\/([0-9a-f-]{36})\/restore$/i);
      if (restoreMatch && UUID.test(restoreMatch[2]) && req.method === 'POST') {
        if (!auth.session?.is_moderator || !requireCsrf(req, auth)) return send(res, 403, { ok: false, error: 'moderator_required' }), true;
        const restored = restoreMatch[1] === 'topics'
          ? await communityStore.restoreTopic(restoreMatch[2], auth.session)
          : await communityStore.restoreReply(restoreMatch[2], auth.session);
        send(res, restored ? 200 : 404, { ok: restored }); return true;
      }

      send(res, 404, { ok: false, error: 'not_found' });
      return true;
    } catch (error) {
      console.error('community request failed', { path: pathname, error: error.message });
      send(res, error.status ?? 500, { ok: false, error: error.status ? error.message : 'internal_error' });
      return true;
    }
  };
}
