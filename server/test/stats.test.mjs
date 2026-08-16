import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { MemoryIdentityStore } from '../src/identity-store.mjs';
import { MemoryStatsStore, normalizeConsent, normalizeSnapshot } from '../src/stats-store.mjs';
import { createPresenceServer } from '../src/server.mjs';

const allFields = { pokedex_seen:true, pokedex_caught:true, badges:true, frontier_streaks:true };

function connect(port) { return new Promise((resolve,reject)=>{ const socket=net.createConnection({host:'127.0.0.1',port},()=>resolve(socket)); socket.once('error',reject); }); }
function messages(socket) { let buffer='',queue=[],wake; socket.on('data',chunk=>{ buffer+=chunk; let index; while((index=buffer.indexOf('\n'))>=0){ queue.push(JSON.parse(buffer.slice(0,index))); buffer=buffer.slice(index+1); } wake?.(); }); return async predicate=>{ for(;;){ const found=queue.find(predicate); if(found)return found; await new Promise((resolve,reject)=>{wake=resolve;setTimeout(()=>reject(new Error('message timeout')),1000);}); } }; }

test('stats validation rejects private, impossible, and duplicate fields', () => {
  assert.deepEqual(normalizeConsent(allFields), allFields);
  assert.equal(normalizeConsent({ ...allFields, party:true }), null);
  assert.equal(normalizeSnapshot({ release:'0.6.0',values:{ pokedex_seen:10,pokedex_caught:11 } }), null);
  assert.equal(normalizeSnapshot({ release:'0.6.0',values:{ trainer_id:1234 } }), null);
  assert.equal(normalizeSnapshot({ release:'0.6.0',values:{ frontier_streaks:[
    {facility:'tower',mode:'singles',level:'50',streak:12},
    {facility:'tower',mode:'singles',level:'50',streak:13}
  ] } }), null);
});

test('per-device consent gates snapshots, field opt-out removes scores, and deletion purges history', async () => {
  const store = new MemoryStatsStore();
  const identity='12345678-1234-4234-8234-123456789abc', credential='87654321-1234-4234-8234-123456789abc';
  const input={release:'0.6.0',values:{pokedex_seen:42,pokedex_caught:30,badges:3,frontier_streaks:[{facility:'tower',mode:'singles',level:'50',streak:9}]}};
  assert.equal((await store.submitSnapshot(identity,credential,input)).error,'stats_consent_required');
  await store.setConsent(identity,credential,true,allFields);
  assert.equal((await store.submitSnapshot(identity,credential,input)).accepted,true);
  assert.equal((await store.listBoards({board:'pokedex-caught'})).entries[0].score,30);
  await store.setConsent(identity,credential,true,{...allFields,pokedex_caught:false});
  assert.equal((await store.listBoards({board:'pokedex-caught'})).entries.length,0);
  assert.equal((await store.submitSnapshot(identity,credential,input)).error,'stats_field_not_consented');
  await store.setConsent(identity,credential,false,{pokedex_seen:false,pokedex_caught:false,badges:false,frontier_streaks:false},true);
  assert.equal((await store.profile(identity)).scores.length,0);
});

test('protocol accepts consented stats but keeps battle and trade rankings disabled', async t => {
  const identities=new MemoryIdentityStore(), stats=new MemoryStatsStore();
  const enrollment=await identities.enroll();
  const presence=createPresenceServer({identityStore:identities,statsStore:stats});
  await new Promise(resolve=>presence.server.listen(0,'127.0.0.1',resolve)); t.after(()=>presence.server.close());
  const socket=await connect(presence.server.address().port); t.after(()=>socket.destroy()); const next=messages(socket);
  socket.write(`${JSON.stringify({type:'hello',version:2,name:'May',identity:enrollment.identityId,token:enrollment.token})}\n`);
  await next(message=>message.type==='welcome');
  socket.write(`${JSON.stringify({type:'stats_snapshot',release:'0.6.0',values:{badges:2}})}\n`);
  assert.equal((await next(message=>message.code==='stats_consent_required')).type,'error');
  socket.write(`${JSON.stringify({type:'stats_consent',enabled:true,fields:allFields})}\n`);
  assert.equal((await next(message=>message.type==='stats_consent_saved')).enabled,true);
  socket.write(`${JSON.stringify({type:'stats_snapshot',release:'0.6.0',values:{badges:2}})}\n`);
  assert.equal((await next(message=>message.type==='stats_snapshot_saved')).count,1);
  assert.equal((await stats.listBoards({board:'online-battles'})).policy.enabled,false);
  assert.equal(presence.metrics.statsSnapshots,1);
});
