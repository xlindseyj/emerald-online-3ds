import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createPresenceServer } from '../src/server.mjs';
import { MemoryIdentityStore } from '../src/identity-store.mjs';
import { MemoryNpcStore } from '../src/npc-store.mjs';
import { MemoryQuestStore } from '../src/quest-store.mjs';
import { MemoryResourceNodeStore } from '../src/resource-node-store.mjs';
import { MemorySkillStore } from '../src/skill-store.mjs';

function connect(port) {
  return new Promise((resolve, reject) => { const s = net.createConnection({ host: '127.0.0.1', port }, () => resolve(s)); s.once('error', reject); });
}
function messages(socket) {
  let buffer = '', queue = [], wake;
  socket.on('data', c => { buffer += c; let i; while ((i = buffer.indexOf('\n')) >= 0) { queue.push(JSON.parse(buffer.slice(0, i))); buffer = buffer.slice(i + 1); } wake?.(); });
  return async predicate => { for (;;) { const index = queue.findIndex(predicate); if (index >= 0) return queue.splice(index, 1)[0]; await new Promise((resolve, reject) => { wake = resolve; setTimeout(() => reject(new Error('message timeout')), 1000); }); } };
}

function seededStores() {
  const npcStore = new MemoryNpcStore();
  const questStore = new MemoryQuestStore();
  const questId = '00000000-0000-4000-8000-000000000001';
  questStore.setQuest({
    id: questId,
    slug: 'welcome-to-hoenn-online',
    title: 'Welcome to Hoenn Online',
    description: 'Help test the online connection.',
    requirements: [],
    reward_kind: 'title',
    reward_data: { title: 'Beta Pioneer' },
    active: true
  });
  npcStore.setNpc('scientist-welcome', {
    name: 'Scientist',
    map: '0-9',
    x: 14,
    y: 13,
    facing: 'down',
    sprite: 'scientist',
    dialogue: ['Welcome to Emerald Online 3DS - Beta!', 'Would you like to join our research team?'],
    quest_id: questId
  });
  return { npcStore, questStore };
}

test('entering a map with an online NPC receives an npc_snapshot', async t => {
  const { npcStore, questStore } = seededStores();
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, npcStore, questStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port, s = await connect(port); t.after(() => s.destroy());
  const next = messages(s);
  s.write('{"type":"hello","version":1,"name":"May"}\n');
  await next(m => m.type === 'welcome');
  s.write('{"type":"state","seq":1,"map":"0-9","x":10,"y":10,"facing":"down"}\n');
  const snapshot = await next(m => m.type === 'npc_snapshot');
  assert.equal(snapshot.map, '0-9');
  assert.equal(snapshot.npcs.length, 1);
  assert.equal(snapshot.npcs[0].npc_id, 'scientist-welcome');
  assert.equal(snapshot.npcs[0].x, 14);
  assert.equal(snapshot.npcs[0].y, 13);
  assert.equal(snapshot.npcs[0].facing, 'down');
});

test('interacting with a nearby NPC returns dialogue and a quest offer', async t => {
  const identityStore = new MemoryIdentityStore();
  const { npcStore, questStore } = seededStores();
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, npcStore, questStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port, s = await connect(port); t.after(() => s.destroy());
  const next = messages(s);
  const enrollment = await identityStore.enroll();
  s.write(JSON.stringify({ type: 'hello', version: 2, name: 'May', identity: enrollment.identityId, token: enrollment.token }) + '\n');
  await next(m => m.type === 'welcome');
  s.write('{"type":"state","seq":1,"map":"0-9","x":14,"y":14,"facing":"down"}\n');
  await next(m => m.type === 'npc_snapshot');
  s.write('{"type":"npc_interact","npc_id":"scientist-welcome"}\n');
  const dialogue = await next(m => m.type === 'npc_dialogue');
  assert.equal(dialogue.npc_id, 'scientist-welcome');
  assert.deepEqual(dialogue.lines, ['Welcome to Emerald Online 3DS - Beta!', 'Would you like to join our research team?']);
  assert.ok(dialogue.quest_offered);
  assert.equal(dialogue.quest_offered.title, 'Welcome to Hoenn Online');
});

test('accepting a quest from an NPC grants the title reward', async t => {
  const identityStore = new MemoryIdentityStore();
  const { npcStore, questStore } = seededStores();
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, npcStore, questStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port, s = await connect(port); t.after(() => s.destroy());
  const next = messages(s);
  const enrollment = await identityStore.enroll();
  s.write(JSON.stringify({ type: 'hello', version: 2, name: 'May', identity: enrollment.identityId, token: enrollment.token }) + '\n');
  await next(m => m.type === 'welcome');
  s.write('{"type":"state","seq":1,"map":"0-9","x":14,"y":14,"facing":"down"}\n');
  await next(m => m.type === 'npc_snapshot');
  s.write('{"type":"npc_interact","npc_id":"scientist-welcome"}\n');
  const dialogue = await next(m => m.type === 'npc_dialogue');
  s.write(JSON.stringify({ type: 'quest_accept', quest_id: dialogue.quest_offered.quest_id }) + '\n');
  const update = await next(m => m.type === 'quest_update');
  assert.equal(update.status, 'claimed');
  assert.equal(update.reward.kind, 'title');
  assert.equal(update.reward.data.title, 'Beta Pioneer');
  const title = await questStore.getEquippedTitle(enrollment.identityId);
  assert.equal(title, 'Beta Pioneer');
});

test('interacting with an NPC from too far away is rejected', async t => {
  const identityStore = new MemoryIdentityStore();
  const { npcStore, questStore } = seededStores();
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, npcStore, questStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port, s = await connect(port); t.after(() => s.destroy());
  const next = messages(s);
  const enrollment = await identityStore.enroll();
  s.write(JSON.stringify({ type: 'hello', version: 2, name: 'May', identity: enrollment.identityId, token: enrollment.token }) + '\n');
  await next(m => m.type === 'welcome');
  s.write('{"type":"state","seq":1,"map":"0-9","x":10,"y":10,"facing":"down"}\n');
  await next(m => m.type === 'npc_snapshot');
  s.write('{"type":"npc_interact","npc_id":"scientist-welcome"}\n');
  assert.equal((await next(m => m.type === 'error')).code, 'npc_not_nearby');
});

test('quest_list returns available and accepted quests', async t => {
  const identityStore = new MemoryIdentityStore();
  const { npcStore, questStore } = seededStores();
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, npcStore, questStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port, s = await connect(port); t.after(() => s.destroy());
  const next = messages(s);
  const enrollment = await identityStore.enroll();
  s.write(JSON.stringify({ type: 'hello', version: 2, name: 'May', identity: enrollment.identityId, token: enrollment.token }) + '\n');
  await next(m => m.type === 'welcome');
  s.write('{"type":"quest_list"}\n');
  const list = await next(m => m.type === 'quest_list');
  assert.equal(list.quests.length, 1);
  assert.equal(list.quests[0].status, 'available');
});

function chainStores() {
  const npcStore = new MemoryNpcStore();
  const questStore = new MemoryQuestStore();
  const resourceNodeStore = new MemoryResourceNodeStore();
  const skillStore = new MemorySkillStore();
  const welcomeId = '00000000-0000-4000-8000-000000000001';
  const fieldId = '00000000-0000-4000-8000-000000000002';
  const reportId = '00000000-0000-4000-8000-000000000003';
  questStore.setQuest({
    id: welcomeId, slug: 'welcome-to-hoenn-online', title: 'Welcome to Hoenn Online',
    description: 'Help test the online connection.', requirements: [],
    reward_kind: 'title', reward_data: { title: 'Beta Pioneer' }, active: true
  });
  questStore.setQuest({
    id: fieldId, slug: 'field-research', title: 'Field Research',
    description: 'Harvest a sample from the apple tree.', active: true,
    requirements: [{ kind: 'quest_completed', quest_id: welcomeId }, { kind: 'interact_resource', node_id: 'littleroot-apple-tree' }],
    reward_kind: 'title', reward_data: { title: 'Beta Pioneer II' }
  });
  questStore.setQuest({
    id: reportId, slug: 'report-findings', title: 'Report Findings',
    description: 'Return to the scientist.', active: true,
    requirements: [{ kind: 'quest_completed', quest_id: fieldId }, { kind: 'talk_to_npc', npc_id: 'scientist-welcome' }],
    reward_kind: 'title', reward_data: { title: 'Research Assistant' }
  });
  npcStore.setNpc('scientist-welcome', {
    name: 'Scientist', map: '0-9', x: 14, y: 13, facing: 'down', sprite: 'scientist',
    dialogue: ['Welcome!'], quest_id: welcomeId
  });
  resourceNodeStore.setNode('littleroot-apple-tree', {
    id: 'littleroot-apple-tree', slug: 'littleroot-apple-tree', kind: 'tree',
    map: '0-9', x: 12, y: 13, level: 1, respawn_seconds: 30, active: true
  });
  return { npcStore, questStore, resourceNodeStore, skillStore, welcomeId, fieldId, reportId };
}

test('entering a map with a resource node receives a resource_snapshot', async t => {
  const { npcStore, questStore, resourceNodeStore, skillStore } = chainStores();
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, npcStore, questStore, resourceNodeStore, skillStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port, s = await connect(port); t.after(() => s.destroy());
  const next = messages(s);
  s.write('{"type":"hello","version":1,"name":"May"}\n');
  await next(m => m.type === 'welcome');
  s.write('{"type":"state","seq":1,"map":"0-9","x":10,"y":10,"facing":"down"}\n');
  const snapshot = await next(m => m.type === 'resource_snapshot');
  assert.equal(snapshot.map, '0-9');
  assert.equal(snapshot.nodes.length, 1);
  assert.equal(snapshot.nodes[0].node_id, 'littleroot-apple-tree');
  assert.equal(snapshot.nodes[0].kind, 'tree');
  assert.equal(snapshot.nodes[0].available, true);
});

test('resource interaction grants skill XP and advances quest progress', async t => {
  const identityStore = new MemoryIdentityStore();
  const { npcStore, questStore, resourceNodeStore, skillStore, welcomeId, fieldId } = chainStores();
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, npcStore, questStore, resourceNodeStore, skillStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port, s = await connect(port); t.after(() => s.destroy());
  const next = messages(s);
  const enrollment = await identityStore.enroll();
  s.write(JSON.stringify({ type: 'hello', version: 2, name: 'May', identity: enrollment.identityId, token: enrollment.token }) + '\n');
  await next(m => m.type === 'welcome');
  // Stand between the scientist (14,13) and the apple tree (12,13).
  s.write('{"type":"state","seq":1,"map":"0-9","x":13,"y":13,"facing":"down"}\n');
  await next(m => m.type === 'resource_snapshot');
  // Accept welcome quest first so field-research becomes available.
  s.write('{"type":"npc_interact","npc_id":"scientist-welcome"}\n');
  const dialogue = await next(m => m.type === 'npc_dialogue');
  s.write(JSON.stringify({ type: 'quest_accept', quest_id: dialogue.quest_offered.quest_id }) + '\n');
  await next(m => m.type === 'quest_update');
  // Accept field-research quest.
  s.write(JSON.stringify({ type: 'quest_accept', quest_id: fieldId }) + '\n');
  await next(m => m.type === 'quest_update');
  // Interact with the resource node.
  s.write('{"type":"resource_interact","node_id":"littleroot-apple-tree"}\n');
  const result = await next(m => m.type === 'resource_interact_result');
  assert.equal(result.ok, true);
  assert.equal(result.node_id, 'littleroot-apple-tree');
  assert.equal(result.kind, 'tree');
  assert.equal(result.skill.skill, 'woodcutting');
  assert.equal(result.skill.xp, 10);
  assert.equal(result.quest_updates.length, 1);
  assert.equal(result.quest_updates[0].quest_id, fieldId);
  assert.equal(result.quest_updates[0].status, 'completed');
  const skill = await skillStore.getSkill(enrollment.identityId, 'woodcutting');
  assert.equal(skill.xp, 10);
});

test('quest chain completes through resource interaction and return NPC', async t => {
  const identityStore = new MemoryIdentityStore();
  const { npcStore, questStore, resourceNodeStore, skillStore, fieldId, reportId } = chainStores();
  const { server } = createPresenceServer({ host: '127.0.0.1', port: 0, identityStore, npcStore, questStore, resourceNodeStore, skillStore });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const port = server.address().port, s = await connect(port); t.after(() => s.destroy());
  const next = messages(s);
  const enrollment = await identityStore.enroll();
  s.write(JSON.stringify({ type: 'hello', version: 2, name: 'May', identity: enrollment.identityId, token: enrollment.token }) + '\n');
  await next(m => m.type === 'welcome');
  // Stand between the scientist (14,13) and the apple tree (12,13).
  s.write('{"type":"state","seq":1,"map":"0-9","x":13,"y":13,"facing":"down"}\n');
  await next(m => m.type === 'npc_snapshot');
  await next(m => m.type === 'resource_snapshot');
  // Accept welcome quest and claim title.
  s.write('{"type":"npc_interact","npc_id":"scientist-welcome"}\n');
  const dialogue = await next(m => m.type === 'npc_dialogue');
  s.write(JSON.stringify({ type: 'quest_accept', quest_id: dialogue.quest_offered.quest_id }) + '\n');
  await next(m => m.type === 'quest_update');
  // Field research should now be available.
  const field = await questStore.getProgress(enrollment.identityId, fieldId);
  assert.ok(!field);
  s.write('{"type":"quest_list"}\n');
  let list = await next(m => m.type === 'quest_list');
  assert.equal(list.quests.find(q => q.slug === 'field-research').status, 'available');
  // Accept field research.
  s.write(JSON.stringify({ type: 'quest_accept', quest_id: fieldId }) + '\n');
  await next(m => m.type === 'quest_update');
  // Interact with resource to complete field research.
  s.write('{"type":"resource_interact","node_id":"littleroot-apple-tree"}\n');
  await next(m => m.type === 'resource_interact_result');
  // Claim field research reward.
  s.write(JSON.stringify({ type: 'quest_claim', quest_id: fieldId }) + '\n');
  const fieldClaim = await next(m => m.type === 'quest_update');
  assert.equal(fieldClaim.status, 'claimed');
  assert.equal(fieldClaim.reward.data.title, 'Beta Pioneer II');
  // Accept report findings.
  s.write(JSON.stringify({ type: 'quest_accept', quest_id: reportId }) + '\n');
  await next(m => m.type === 'quest_update');
  // Talk to scientist to complete.
  s.write('{"type":"npc_interact","npc_id":"scientist-welcome"}\n');
  const finalDialogue = await next(m => m.type === 'npc_dialogue');
  assert.equal(finalDialogue.quest_updates.length, 1);
  assert.equal(finalDialogue.quest_updates[0].quest_id, reportId);
  assert.equal(finalDialogue.quest_updates[0].status, 'completed');
  const reportProgress = await questStore.getProgress(enrollment.identityId, reportId);
  assert.equal(reportProgress.status, 'completed');
  s.write(JSON.stringify({ type: 'quest_claim', quest_id: reportId }) + '\n');
  const reportClaim = await next(m => m.type === 'quest_update');
  assert.equal(reportClaim.status, 'claimed');
  assert.equal(reportClaim.reward.data.title, 'Research Assistant');
});
