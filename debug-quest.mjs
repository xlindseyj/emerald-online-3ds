import test from 'node:test';
import net from 'node:net';
import { createPresenceServer } from './server/src/server.mjs';
import { MemoryIdentityStore } from './server/src/identity-store.mjs';
import { MemoryNpcStore } from './server/src/npc-store.mjs';
import { MemoryQuestStore } from './server/src/quest-store.mjs';
import { MemoryResourceNodeStore } from './server/src/resource-node-store.mjs';
import { MemorySkillStore } from './server/src/skill-store.mjs';

function connect(port) {
  return new Promise((resolve, reject) => { const s = net.createConnection({ host: '127.0.0.1', port }, () => resolve(s)); s.once('error', reject); });
}
function messages(socket) {
  let buffer = '', queue = [], wake;
  socket.on('data', c => { buffer += c; let i; while ((i = buffer.indexOf('\n')) >= 0) { const msg = JSON.parse(buffer.slice(0, i)); console.log('RECV', msg.type, JSON.stringify(msg).slice(0,400)); queue.push(msg); buffer = buffer.slice(i + 1); } wake?.(); });
  return async predicate => { for (;;) { const index = queue.findIndex(predicate); if (index >= 0) return queue.splice(index, 1)[0]; await new Promise((resolve, reject) => { wake = resolve; setTimeout(() => reject(new Error('message timeout')), 2000); }); } };
}

test('debug resource interact', async t => {
  const npcStore = new MemoryNpcStore();
  const questStore = new MemoryQuestStore();
  const resourceNodeStore = new MemoryResourceNodeStore();
  const skillStore = new MemorySkillStore();
  const welcomeId = '00000000-0000-4000-8000-000000000001';
  const fieldId = '00000000-0000-4000-8000-000000000002';
  questStore.setQuest({ id: welcomeId, slug: 'welcome-to-hoenn-online', title: 'Welcome', description: 'x', requirements: [], reward_kind: 'title', reward_data: { title: 'Beta Pioneer' }, active: true });
  questStore.setQuest({ id: fieldId, slug: 'field-research', title: 'Field', description: 'x', active: true, requirements: [{ kind: 'quest_completed', quest_id: welcomeId }, { kind: 'interact_resource', node_id: 'tree' }], reward_kind: 'title', reward_data: { title: 'Beta Pioneer II' } });
  npcStore.setNpc('scientist-welcome', { name: 'Scientist', map: '0-9', x: 14, y: 13, facing: 'down', sprite: 'scientist', dialogue: ['hi'], quest_id: welcomeId });
  resourceNodeStore.setNode('tree', { id: 'tree', slug: 'tree', kind: 'tree', map: '0-9', x: 12, y: 13, level: 1, respawn_seconds: 30, active: true });
  const identityStore = new MemoryIdentityStore();
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, npcStore, questStore, resourceNodeStore, skillStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port, s = await connect(port); t.after(() => s.destroy());
  const next = messages(s);
  const enrollment = await identityStore.enroll();
  s.write(JSON.stringify({ type: 'hello', version: 2, name: 'May', identity: enrollment.identityId, token: enrollment.token }) + '\n');
  await next(m => m.type === 'welcome');
  s.write('{"type":"state","seq":1,"map":"0-9","x":13,"y":13,"facing":"down"}\n');
  await next(m => m.type === 'resource_snapshot');
  s.write('{"type":"npc_interact","npc_id":"scientist-welcome"}\n');
  const dialogue = await next(m => m.type === 'npc_dialogue');
  console.log('DIALOGUE quest_offered', dialogue.quest_offered);
  s.write(JSON.stringify({ type: 'quest_accept', quest_id: dialogue.quest_offered.quest_id }) + '\n');
  const qu = await next(m => m.type === 'quest_update');
  console.log('QUEST_UPDATE', qu);
  console.log('sending resource_interact');
  s.write('{"type":"resource_interact","node_id":"tree"}\n');
  const result = await next(m => m.type === 'resource_interact_result');
  console.log('RESULT', JSON.stringify(result));
});
