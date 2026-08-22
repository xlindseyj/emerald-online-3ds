import test from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { PostgresIdentityStore } from '../src/identity-store.mjs';
import { PostgresStatsStore } from '../src/stats-store.mjs';

const databaseUrl=process.env.TEST_DATABASE_URL;
const fields={pokedex_seen:true,pokedex_caught:true,badges:true,frontier_streaks:true};

test('PostgreSQL stats lifecycle enforces consent, pagination, quarantine, opt-out, and deletion', {skip:!databaseUrl}, async t => {
  const pool=new pg.Pool({connectionString:databaseUrl});
  const identities=new PostgresIdentityStore(pool,'stats-test-pepper-with-at-least-thirty-two-bytes');
  const stats=new PostgresStatsStore(pool); const enrollment=await identities.enroll(),reviewer=await identities.enroll();
  t.after(async()=>{await identities.deleteIdentity(enrollment.identityId);await identities.deleteIdentity(reviewer.identityId);await pool.end()});
  const input={release:'0.6.0',values:{pokedex_seen:20,pokedex_caught:10,badges:2,frontier_streaks:[{facility:'tower',mode:'singles',level:'50',streak:5}]}};
  assert.equal((await stats.submitSnapshot(enrollment.identityId,enrollment.credentialId,input)).error,'stats_consent_required');
  assert.ok(await stats.setConsent(enrollment.identityId,enrollment.credentialId,true,fields));
  assert.equal((await stats.submitSnapshot(enrollment.identityId,enrollment.credentialId,input)).accepted,true);
  const board=await stats.listBoards({board:'pokedex-caught',release:'0.6.0',page:1,pageSize:1});
  assert.equal(board.total,1); assert.equal(board.entries[0].fingerprint,enrollment.fingerprint); assert.equal(board.entries[0].integrity_label,'Community-submitted');
  const suspicious=await stats.submitSnapshot(enrollment.identityId,enrollment.credentialId,{release:'0.6.0',values:{pokedex_seen:200}});
  assert.equal(suspicious.entries[0].review_status,'under-review');
  const preserved=await stats.listBoards({board:'pokedex-seen',release:'0.6.0'}); assert.equal(preserved.total,1); assert.equal(preserved.entries[0].score,20);
  const review=(await stats.listUnderReview())[0]; assert.equal(review.fingerprint,enrollment.fingerprint);
  assert.equal(await stats.resolveReview(review.id,'accept',enrollment.identityId),false);
  assert.equal(await stats.resolveReview(review.id,'accept',reviewer.identityId),true);
  const accepted=await stats.listBoards({board:'pokedex-seen',release:'0.6.0'}); assert.equal(accepted.total,1); assert.equal(accepted.entries[0].score,200);
  assert.equal((await pool.query("SELECT count(*)::int count FROM moderation_audit WHERE actor_identity_id=$1 AND action='leaderboard_review_resolved'",[reviewer.identityId])).rows[0].count,1);
  await stats.reportCompatibility(enrollment.identityId,{release:'0.6.0',artifactHash:'b'.repeat(64),consoleModel:'old-3ds-xl',installMethod:'cia',transport:'wss',result:'partial',notes:'Physical result.'});
  const compatibility=await stats.listBoards({board:'beta-compatibility',release:'0.6.0'});assert.equal(compatibility.entries[0].score,1);assert.equal(compatibility.entries[0].integrity_label,'Server-observed');
  await stats.setConsent(enrollment.identityId,enrollment.credentialId,true,{...fields,pokedex_caught:false});
  assert.equal((await stats.listBoards({board:'pokedex-caught',release:'0.6.0'})).total,0);
  await stats.setConsent(enrollment.identityId,enrollment.credentialId,false,{pokedex_seen:false,pokedex_caught:false,badges:false,frontier_streaks:false},true);
  assert.equal((await pool.query('SELECT count(*)::int count FROM stat_snapshot_history h JOIN leaderboard_entries e ON e.id=h.entry_id WHERE e.identity_id=$1',[enrollment.identityId])).rows[0].count,0);
  await stats.deleteIdentityStats(enrollment.identityId);assert.equal((await pool.query('SELECT count(*)::int count FROM compatibility_reports WHERE identity_id=$1',[enrollment.identityId])).rows[0].count,0);
});
