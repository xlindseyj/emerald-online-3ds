import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import WebSocket from 'ws';

const base=process.env.PUBLIC_BASE_URL??'https://emeraldonline3ds.com';
const game=process.env.GAME_PUBLIC_URL??'wss://live.emeraldonline3ds.com/game';
const release=process.env.RELEASE_VERSION??'0.7.1';
let socket,identity,token,fingerprint;
const queue=[];let wake;
function send(message){socket.send(`${JSON.stringify(message)}\n`)}
function next(type){return new Promise((resolve,reject)=>{const deadline=setTimeout(()=>reject(new Error(`timeout waiting for ${type}`)),10000);const check=()=>{const index=queue.findIndex(message=>message.type===type||(type==='error'&&message.type==='error'));if(index<0){wake=check;return}clearTimeout(deadline);resolve(queue.splice(index,1)[0])};check()})}
async function api(path,options={}){const response=await fetch(`${base}${path}`,options);const data=await response.json();if(!response.ok)throw new Error(`${path}: ${data.error??response.status}`);return{data,response}}
async function cleanup(){if(!identity||!token)return;try{if(!socket||socket.readyState!==WebSocket.OPEN){socket=new WebSocket(game);await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject)});send({type:'hello',version:2,name:'Cleanup',identity,token,avatar:'girl'});await next('welcome')}send({type:'delete_identity',confirm:'DELETE'});await next('identity_deleted')}catch{}finally{socket?.terminate()}}

try{
  socket=new WebSocket(game);
  socket.on('message',data=>{for(const line of data.toString().split('\n').filter(Boolean))queue.push(JSON.parse(line));wake?.()});
  await new Promise((resolve,reject)=>{socket.once('open',resolve);socket.once('error',reject)});
  send({type:'enroll',version:2,name:'GateThree',avatar:'girl'});
  const enrolled=await next('enrolled');identity=enrolled.id;token=enrolled.token;fingerprint=enrolled.fingerprint;
  const fields={pokedex_seen:true,pokedex_caught:true,badges:true,frontier_streaks:true};
  send({type:'stats_consent',enabled:true,fields});assert.equal((await next('stats_consent_saved')).enabled,true);
  send({type:'stats_snapshot',release,values:{pokedex_seen:42,pokedex_caught:24,badges:3,frontier_streaks:[{facility:'tower',mode:'singles',level:'50',streak:7}]}});
  assert.equal((await next('stats_snapshot_saved')).count,4);

  const pairing=(await api('/api/community/pairing/start',{method:'POST'})).data;
  send({type:'pair_browser_approve',code:pairing.code});await next('browser_pairing_approved');
  const consumed=await api('/api/community/pairing/consume',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(pairing)});
  const cookie=consumed.response.headers.get('set-cookie').split(';',1)[0],csrf=consumed.data.csrfToken;
  const headers={cookie,'content-type':'application/json','x-csrf-token':csrf};
  const profile=(await api('/api/community/profile',{headers:{cookie}})).data;
  assert.equal(profile.fingerprint,fingerprint);assert.equal(profile.stats.scores.some(row=>row.board==='pokedex-caught'&&row.score===24),true);
  const board=(await api(`/api/community/leaderboards?board=pokedex-caught&release=${release}&page=1`,{headers:{cookie}})).data;
  assert.equal(board.entries.some(entry=>entry.fingerprint===fingerprint&&entry.score===24),true);assert.equal(board.policy.integrity_label,'Community-submitted');
  const disabled=(await api(`/api/community/leaderboards?board=online-battles&release=${release}&page=1`,{headers:{cookie}})).data;assert.equal(disabled.policy.enabled,false);
  await api('/api/community/compatibility-reports',{method:'POST',headers,body:JSON.stringify({release,artifactHash:crypto.createHash('sha256').update('gate3-live-smoke').digest('hex'),consoleModel:'emulator',installMethod:'3dsx',transport:'wss',result:'pass',notes:'Automated production lifecycle smoke.'})});
  const compatibility=(await api(`/api/community/leaderboards?board=beta-compatibility&release=${release}&page=1`,{headers:{cookie}})).data;assert.equal(compatibility.entries.some(entry=>entry.fingerprint===fingerprint&&entry.score===1),true);assert.equal(compatibility.policy.integrity_label,'Server-observed');
  send({type:'stats_consent',enabled:true,fields:{...fields,pokedex_caught:false}});await next('stats_consent_saved');
  const optedOut=(await api(`/api/community/leaderboards?board=pokedex-caught&release=${release}&page=1`,{headers:{cookie}})).data;assert.equal(optedOut.entries.some(entry=>entry.fingerprint===fingerprint),false);
  await api('/api/community/stats',{method:'DELETE',headers,body:JSON.stringify({confirm:'DELETE ALL STATS'})});
  const deleted=(await api('/api/community/profile',{headers:{cookie}})).data;assert.equal(deleted.stats.scores.length,0);
  send({type:'delete_identity',confirm:'DELETE'});await next('identity_deleted');identity=null;socket.close();
  console.log(JSON.stringify({ok:true,release,wss:game,pairing:true,consent:true,snapshot:true,profile:true,pagination:true,disabledPeerBoards:true,compatibility:true,fieldOptOut:true,historicalDeletion:true,syntheticIdentityDeleted:true}));
}catch(error){await cleanup();throw error}
