import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresIdentityStore } from '../src/identity-store.mjs';
import { PostgresCommunityStore } from '../src/community-store.mjs';

const databaseUrl = process.env.TEST_DATABASE_URL;

test('PostgreSQL pairing, visibility, forum, defect, report, and recovery lifecycle', { skip: !databaseUrl }, async t => {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  const identities = new PostgresIdentityStore(pool, 'community-test-pepper-with-at-least-thirty-two-bytes');
  const community = new PostgresCommunityStore(pool);
  const enrollment = await identities.enroll();
  const cleanupIdentities = [enrollment.identityId];
  t.after(async () => { for (const identityId of cleanupIdentities) await identities.deleteIdentity(identityId); await pool.end(); });

  const pairing = await identities.startPairing();
  assert.ok(await identities.approvePairing(enrollment.identityId, enrollment.credentialId, pairing.code));
  const browser = await identities.consumePairing(pairing.code, pairing.requestToken);
  const viewer = await identities.authenticateBrowserSession(browser.token);
  assert.equal(viewer.identity_id, enrollment.identityId);
  assert.equal(await identities.consumePairing(pairing.code, pairing.requestToken), null);

  const categories = await community.categories(null);
  assert.equal(categories.find(category => category.slug === 'installation-help').readable, true);
  assert.equal(categories.find(category => category.slug === 'beta-testing').readable, false);
  assert.equal(categories.find(category => category.slug === 'bugs-defects').readable, true);
  assert.equal(await community.createTopic({ category: 'releases', title: 'Unauthorized release', body: 'No.' }, viewer), null);

  const suffix = enrollment.identityId.slice(0, 8);
  const help = await community.createTopic({ category: 'installation-help', title: `Install help ${suffix}`, body: 'Public recovery instructions.' }, viewer);
  const beta = await community.createTopic({ category: 'beta-testing', title: `Private beta ${suffix}`, body: 'Paired-only result.' }, viewer);
  const defect = await community.createTopic({
    category: 'bugs-defects', title: `E71 defect ${suffix}`, body: 'Structured diagnostic.',
    defect: { severity: 'high', reproductionSteps: 'Launch.', expectedBehavior: 'Online.', actualBehavior: 'E71.', runtimeVersion: '0.4.0', artifactHash: 'b'.repeat(64), consoleModel: 'old-3ds-xl', installMethod: '3dsx', transport: 'wss', diagnosticText: 'stage=3' }
  }, viewer);

  const publicBefore = await community.listTopics({ viewer: null, pageSize: 50 });
  assert.ok(publicBefore.topics.some(topic => topic.id === help.id));
  assert.equal(publicBefore.topics.some(topic => topic.id === beta.id), false);
  assert.equal(publicBefore.topics.some(topic => topic.id === defect.id), false);

  await pool.query("INSERT INTO identity_roles(identity_id,role) VALUES($1,'moderator')", [enrollment.identityId]);
  const moderator = await identities.authenticateBrowserSession(browser.token);
  assert.equal(moderator.is_moderator, true);
  const defectTopic = await community.getTopic(defect.id, moderator);
  assert.ok(await community.updateDefect(defectTopic.defect_id, { status: 'confirmed', targetRelease: '0.4.1' }, moderator));
  assert.equal((await community.getTopic(defect.id, null)).defect_status, 'confirmed');

  const reply = await community.createReply(help.id, 'Additional public detail.', viewer);
  const report = await community.report({ postId: reply.id, reason: 'Test report evidence' }, viewer);
  assert.ok(report.id);
  assert.ok(await community.updateReport(report.id, 'resolved', moderator));
  assert.equal((await community.listReports(moderator)).find(item => item.id === report.id).status, 'resolved');
  assert.ok(await community.moderateTopic(help.id, { pinned: true, locked: true }, moderator));
  assert.equal((await community.getTopic(help.id, null)).pinned, true);

  const targetEnrollment = await identities.enroll();
  cleanupIdentities.push(targetEnrollment.identityId);
  const targetPairing = await identities.startPairing();
  await identities.approvePairing(targetEnrollment.identityId, targetEnrollment.credentialId, targetPairing.code);
  const targetBrowser = await identities.consumePairing(targetPairing.code, targetPairing.requestToken);
  const targetViewer = await identities.authenticateBrowserSession(targetBrowser.token);
  const targetTopic = await community.createTopic({ category: 'general', title: `Moderation target ${suffix}`, body: 'Target post.' }, targetViewer);
  const sanction = await community.sanctionTopicAuthor(targetTopic.id, { kind: 'read-only', reason: 'Repeated test-policy violation' }, moderator);
  assert.ok(sanction.id);
  assert.equal((await community.activeSanctions(targetViewer))[0].kind, 'read-only');
  assert.equal(await community.createTopic({ category: 'general', title: 'Blocked write', body: 'No.' }, targetViewer), null);
  assert.ok(await community.revokeSanction(sanction.id, moderator));
  assert.ok(await community.createTopic({ category: 'general', title: `Restored write ${suffix}`, body: 'Allowed.' }, targetViewer));
  const overview = await community.moderationOverview(moderator);
  assert.ok(overview.audit.some(entry => entry.action === 'sanction_created'));

  assert.ok(await community.deleteReply(reply.id, viewer));
  assert.ok(await community.restoreReply(reply.id, moderator));
  assert.ok(await community.deleteTopic(beta.id, viewer));
  assert.ok(await community.restoreTopic(beta.id, moderator));
  assert.ok((await community.getTopic(beta.id, viewer)).id);
});
