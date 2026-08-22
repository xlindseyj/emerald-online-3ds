import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { MemoryIdentityStore } from '../server/src/identity-store.mjs';
import { MemoryCommunityStore } from '../server/src/community-store.mjs';
import { MemoryStatsStore } from '../server/src/stats-store.mjs';
import { createCommunityApp } from './community-app.mjs';
import { communityPage, communityScript } from './community-page.mjs';
import { formatReleaseTopic, releaseContentHash, validateReleaseCatalog } from '../server/src/release-catalog.mjs';
import { communityPublicationContentHash, validateCommunityPublicationCatalog } from '../server/src/community-publication-catalog.mjs';
import fs from 'node:fs';
import path from 'node:path';

const communityStyles = fs.readFileSync(path.join(import.meta.dirname, 'community.css'), 'utf8');

async function startApp(t) {
  const identityStore = new MemoryIdentityStore();
  const communityStore = new MemoryCommunityStore();
  const statsStore = new MemoryStatsStore();
  const handler = createCommunityApp({ identityStore, communityStore, statsStore, secureCookies: false, page: communityPage });
  const server = http.createServer(async (req, res) => {
    const handled = await handler(req, res, new URL(req.url, 'http://localhost'));
    if (!handled) res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { identityStore, communityStore, statsStore, base: `http://127.0.0.1:${server.address().port}` };
}

async function pair(base, identityStore, enrollment) {
  const startedResponse = await fetch(`${base}/api/community/pairing/start`, { method: 'POST' });
  assert.equal(startedResponse.status, 201);
  const started = await startedResponse.json();
  assert.match(started.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.ok(await identityStore.approvePairing(enrollment.identityId, enrollment.credentialId, started.code));
  const consumedResponse = await fetch(`${base}/api/community/pairing/consume`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(started)
  });
  assert.equal(consumedResponse.status, 200);
  const consumed = await consumedResponse.json();
  const cookie = consumedResponse.headers.get('set-cookie').split(';', 1)[0];
  return { cookie, csrf: consumed.csrfToken };
}

function request(base, route, auth = null, options = {}) {
  const headers = { ...(options.headers ?? {}) };
  if (auth?.cookie) headers.cookie = auth.cookie;
  if (auth?.csrf && options.method && options.method !== 'GET') headers['x-csrf-token'] = auth.csrf;
  if (options.body && !headers['content-type']) headers['content-type'] = 'application/json';
  return fetch(`${base}${route}`, { ...options, headers });
}

test('community page is public, anonymous, and explains 3DS pairing', async t => {
  const { base } = await startApp(t);
  const response = await fetch(`${base}/community`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
  assert.match(response.headers.get('content-security-policy'), /style-src 'self'/);
  const body = await response.text();
  assert.match(body, /tap your trainer profile on the bottom screen/);
  assert.match(body, /optional identity linking—not registration/);
  assert.match(body, /Not affiliated with Nintendo/);
  assert.doesNotMatch(body, /Private Organization|Internal Workspace/);
  assert.match(body, /Leaderboards/);
  assert.match(body, /id="defectfields" class="composer hidden" disabled/);
  assert.match(body, /id="boardtoggle"[^>]+aria-expanded="false"/);
  assert.match(body, /id="community-main"/);
  assert.match(body, /role="status" aria-live="polite"/);
  assert.match(communityScript, /fields\.disabled=!isDefect/);
  assert.match(communityScript, /document\.createElement\('a'\)/);
  assert.match(communityScript, /closeBoardNavigation/);
  assert.match(communityScript, /event\.key==='Escape'/);
  assert.match(communityScript, /querySelector\('button,a'\)\.focus\(\)/);
  assert.match(communityStyles, /\.sidebar\{order:2;position:fixed/);
});

test('profiles and leaderboards are paired-only and stats deletion requires CSRF plus confirmation', async t => {
  const {base,identityStore,statsStore}=await startApp(t);
  assert.equal((await request(base,'/api/community/profile')).status,403);
  assert.equal((await request(base,'/api/community/leaderboards')).status,403);
  const enrollment=await identityStore.enroll(),auth=await pair(base,identityStore,enrollment);
  const fields={pokedex_seen:true,pokedex_caught:true,badges:true,frontier_streaks:true};
  await statsStore.setConsent(enrollment.identityId,enrollment.credentialId,true,fields);
  await statsStore.submitSnapshot(enrollment.identityId,enrollment.credentialId,{release:'0.6.0',values:{pokedex_seen:25,pokedex_caught:12,badges:2}});
  const profile=await (await request(base,'/api/community/profile',auth)).json();
  assert.equal(profile.stats.scores.some(row=>row.credentialId),false);
  const board=await (await request(base,'/api/community/leaderboards?board=pokedex-caught&release=0.6.0&page=1',auth)).json();
  assert.equal(board.entries[0].score,12);
  assert.equal(board.policy.integrity_label,'Community-submitted');
  const disabled=await (await request(base,'/api/community/leaderboards?board=online-battles&release=0.6.0&page=1',auth)).json();
  assert.equal(disabled.policy.enabled,false);
  const compatibility=await request(base,'/api/community/compatibility-reports',auth,{method:'POST',body:JSON.stringify({release:'0.6.0',artifactHash:'a'.repeat(64),consoleModel:'old-3ds-xl',installMethod:'cia',transport:'wss',result:'partial',notes:'WSS connected; physical UI retest pending.'})});
  assert.equal(compatibility.status,201);
  const compatibilityBoard=await (await request(base,'/api/community/leaderboards?board=beta-compatibility&release=0.6.0&page=1',auth)).json();
  assert.equal(compatibilityBoard.entries[0].score,1);assert.equal(compatibilityBoard.policy.integrity_label,'Server-observed');
  assert.equal((await request(base,'/api/community/stats',auth,{method:'DELETE',body:JSON.stringify({confirm:'wrong'})})).status,400);
  assert.equal((await request(base,'/api/community/stats',auth,{method:'DELETE',body:JSON.stringify({confirm:'DELETE ALL STATS'})})).status,200);
  assert.equal((await statsStore.profile(enrollment.identityId)).scores.length,0);
});

test('pairing gates private boards and forum writes while public help remains readable', async t => {
  const { base, identityStore } = await startApp(t);
  const enrollment = await identityStore.enroll();
  const auth = await pair(base, identityStore, enrollment);

  const noCsrf = await request(base, '/api/community/topics', { cookie: auth.cookie }, {
    method: 'POST', body: JSON.stringify({ category: 'general', title: 'No CSRF', body: 'Should fail' })
  });
  assert.equal(noCsrf.status, 403);

  const staffOnly = await request(base, '/api/community/topics', auth, {
    method: 'POST', body: JSON.stringify({ category: 'releases', title: 'Fake release', body: 'Nope' })
  });
  assert.equal(staffOnly.status, 403);

  const help = await request(base, '/api/community/topics', auth, {
    method: 'POST', body: JSON.stringify({ category: 'installation-help', title: 'Recover from E71', body: 'Check the **stage** and `gpsp-debug.log`.' })
  });
  assert.equal(help.status, 201);

  const privateTopic = await request(base, '/api/community/topics', auth, {
    method: 'POST', body: JSON.stringify({ category: 'beta-testing', title: 'Private beta result', body: '<img src=x onerror=alert(1)>\n\n```js\nconst safe = true;\n```' })
  });
  assert.equal(privateTopic.status, 201);
  const privateId = (await privateTopic.json()).id;

  const anonymous = await (await fetch(`${base}/api/community/topics`)).json();
  assert.equal(anonymous.topics.some(topic => topic.id === privateId), false);
  assert.equal(anonymous.topics.some(topic => topic.title === 'Recover from E71'), true);
  assert.equal((await fetch(`${base}/api/community/topics/${privateId}`)).status, 404);

  const pairedTopic = await (await request(base, `/api/community/topics/${privateId}`, auth)).json();
  assert.equal('author_identity_id' in pairedTopic.topic, false);
  assert.match(pairedTopic.topic.body_html, /&lt;img/);
  assert.doesNotMatch(pairedTopic.topic.body_html, /<img/i);
  assert.match(pairedTopic.topic.body_html, /<pre><code class="language-js">/);

  const reply = await request(base, `/api/community/topics/${privateId}/replies`, auth, {
    method: 'POST', body: JSON.stringify({ body: 'Retested on an Old 3DS XL.' })
  });
  assert.equal(reply.status, 201);
  const replyId = (await reply.json()).id;
  const withReply = await (await request(base, `/api/community/topics/${privateId}`, auth)).json();
  assert.equal('author_identity_id' in withReply.topic.posts[0], false);
  assert.equal((await request(base, `/api/community/posts/${replyId}`, auth, { method: 'PATCH', body: JSON.stringify({ body: '' }) })).status, 400);
  assert.equal((await request(base, `/api/community/topics/${privateId}/subscription`, auth, { method: 'PUT', body: JSON.stringify({ subscribed: false }) })).status, 200);
  assert.equal((await request(base, '/api/community/reports', auth, { method: 'POST', body: JSON.stringify({ postId: replyId, reason: 'Contains private information' }) })).status, 201);
});

test('official releases are public, visibly attributed, and keep replies available', async t => {
  const { base, identityStore, communityStore } = await startApp(t);
  const catalog = validateReleaseCatalog(JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'release', 'release-catalog.json'), 'utf8')));
  const release = catalog.at(-1), topic = formatReleaseTopic(release);
  const published = await communityStore.upsertOfficialRelease({ ...release, ...topic, contentHash: releaseContentHash(release, topic) });
  await communityStore.pinLatestOfficialRelease(release.version);
  const anonymous = await (await request(base, '/api/community/topics?category=releases')).json();
  const summary = anonymous.topics.find(item => item.id === published.topicId);
  assert.equal(summary.official_release, true);
  assert.equal(summary.release_version, release.version);
  assert.equal(summary.author_fingerprint, null);
  const detail = await (await request(base, `/api/community/topics/${published.topicId}`)).json();
  assert.match(detail.topic.body_html, /<img src="\/qr\.svg"/);
  assert.equal(detail.topic.source_commit, release.sourceCommit ?? null);
  const enrollment = await identityStore.enroll(), auth = await pair(base, identityStore, enrollment);
  assert.equal((await request(base, `/api/community/topics/${published.topicId}/replies`, auth, { method: 'POST', body: JSON.stringify({ body: 'Physical test result.' }) })).status, 201);
});

test('official installation guides are public, attributed, and addressable by stable key', async t => {
  const { base, communityStore } = await startApp(t);
  const catalog = validateCommunityPublicationCatalog(JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '..', 'release', 'community-pages.json'), 'utf8')));
  const guide = catalog.find(item => item.key === 'install-on-3ds');
  const published = await communityStore.upsertOfficialCommunityPublication({
    ...guide, contentHash: communityPublicationContentHash(guide)
  });

  const response = await request(base, '/api/community/publications/install-on-3ds');
  assert.equal(response.status, 200);
  const detail = await response.json();
  assert.equal(detail.topic.id, published.topicId);
  assert.equal(detail.topic.official_publication, true);
  assert.equal(detail.topic.publication_kind, 'guide');
  assert.equal(detail.topic.author_fingerprint, null);
  assert.match(detail.topic.body_html, /<img src="\/qr\.svg"/);

  const listing = await (await request(base, '/api/community/topics?category=installation-help')).json();
  assert.equal(listing.topics.some(item => item.publication_key === guide.key && item.official_publication), true);
  assert.equal((await request(base, '/api/community/publications/missing-guide')).status, 404);
});

test('new defects stay paired-only until a moderator confirms them', async t => {
  const { base, identityStore } = await startApp(t);
  const enrollment = await identityStore.enroll();
  const auth = await pair(base, identityStore, enrollment);
  const createdResponse = await request(base, '/api/community/topics', auth, {
    method: 'POST', body: JSON.stringify({
      category: 'bugs-defects', title: 'Connection fails after certificate rotation', body: 'Structured report.',
      defect: { severity: 'high', reproductionSteps: 'Launch while online.', expectedBehavior: 'Status reaches ONLINE.', actualBehavior: 'Status shows E71.', runtimeVersion: '0.4.0', artifactHash: 'a'.repeat(64), consoleModel: 'old-3ds-xl', installMethod: '3dsx', transport: 'wss', diagnosticText: 'stage=3 tls=-9984 verify=00000200' }
    })
  });
  assert.equal(createdResponse.status, 201);
  const topicId = (await createdResponse.json()).id;
  assert.equal((await fetch(`${base}/api/community/topics/${topicId}`)).status, 404);

  identityStore.identities.get(enrollment.identityId).isModerator = true;
  const session = await (await request(base, '/api/community/session', auth)).json();
  auth.csrf = session.csrfToken;
  assert.equal(session.moderator, true);
  const pairedTopic = await (await request(base, `/api/community/topics/${topicId}`, auth)).json();
  const updated = await request(base, `/api/community/moderation/defects/${pairedTopic.topic.defect_id}`, auth, {
    method: 'PATCH', body: JSON.stringify({ status: 'confirmed', targetRelease: '0.4.1' })
  });
  assert.equal(updated.status, 200);

  const publicTopic = await fetch(`${base}/api/community/topics/${topicId}`);
  assert.equal(publicTopic.status, 200);
  assert.equal((await publicTopic.json()).topic.defect_status, 'confirmed');
});

test('admin sessions inherit moderator access and expose the admin role', async t => {
  const { base, identityStore } = await startApp(t);
  const enrollment = await identityStore.enroll();
  identityStore.identities.get(enrollment.identityId).isAdmin = true;
  const auth = await pair(base, identityStore, enrollment);
  const session = await (await request(base, '/api/community/session', auth)).json();
  assert.equal(session.admin, true);
  assert.equal(session.moderator, true);
  assert.equal((await request(base, '/api/community/moderation/overview', auth)).status, 200);
});

test('paired topic creation is rate limited per identity', async t => {
  const { base, identityStore } = await startApp(t);
  const enrollment = await identityStore.enroll();
  const auth = await pair(base, identityStore, enrollment);
  for (let index = 0; index < 61; index += 1) {
    const rejected = await request(base, '/api/community/topics', { cookie: auth.cookie }, {
      method: 'POST', body: JSON.stringify({ category: 'general', title: `CSRF abuse ${index}`, body: 'Rejected.' })
    });
    assert.equal(rejected.status, 403);
  }
  for (let index = 0; index < 5; index += 1) {
    const response = await request(base, '/api/community/topics', auth, {
      method: 'POST', body: JSON.stringify({ category: 'general', title: `Rate test ${index}`, body: 'Bounded write.' })
    });
    assert.equal(response.status, 201);
  }
  const limited = await request(base, '/api/community/topics', auth, {
    method: 'POST', body: JSON.stringify({ category: 'general', title: 'Rate test blocked', body: 'Must be rejected.' })
  });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).error, 'community_rate_limited');
});

test('moderators can sanction another topic author but cannot sanction themselves', async t => {
  const { base, identityStore } = await startApp(t);
  const moderatorEnrollment = await identityStore.enroll();
  const targetEnrollment = await identityStore.enroll();
  identityStore.identities.get(moderatorEnrollment.identityId).isModerator = true;
  const moderator = await pair(base, identityStore, moderatorEnrollment);
  const target = await pair(base, identityStore, targetEnrollment);

  const moderatorTopic = await request(base, '/api/community/topics', moderator, {
    method: 'POST', body: JSON.stringify({ category: 'general', title: 'Moderator topic', body: 'Staff authored.' })
  });
  const moderatorTopicId = (await moderatorTopic.json()).id;
  const selfSanction = await request(base, '/api/community/moderation/sanctions', moderator, {
    method: 'POST', body: JSON.stringify({ topicId: moderatorTopicId, kind: 'read-only', reason: 'Self sanction must fail' })
  });
  assert.equal(selfSanction.status, 404);

  const targetTopic = await request(base, '/api/community/topics', target, {
    method: 'POST', body: JSON.stringify({ category: 'general', title: 'Target topic', body: 'Moderated content.' })
  });
  const targetTopicId = (await targetTopic.json()).id;
  const sanctionResponse = await request(base, '/api/community/moderation/sanctions', moderator, {
    method: 'POST', body: JSON.stringify({ topicId: targetTopicId, kind: 'read-only', reason: 'Automated moderation test' })
  });
  assert.equal(sanctionResponse.status, 201);
  const sanctionId = (await sanctionResponse.json()).id;

  const targetSession = await (await request(base, '/api/community/session', target)).json();
  assert.equal(targetSession.sanctions.some(item => item.id === sanctionId && item.kind === 'read-only'), true);
  const blocked = await request(base, '/api/community/topics', target, {
    method: 'POST', body: JSON.stringify({ category: 'general', title: 'Blocked topic', body: 'Must not publish.' })
  });
  assert.equal(blocked.status, 403);

  assert.equal((await request(base, `/api/community/moderation/sanctions/${sanctionId}`, moderator, { method: 'DELETE' })).status, 200);
  const restored = await request(base, '/api/community/topics', target, {
    method: 'POST', body: JSON.stringify({ category: 'general', title: 'Restored topic', body: 'Write access restored.' })
  });
  assert.equal(restored.status, 201);
});
