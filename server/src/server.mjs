import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { PostgresIdentityStore } from './identity-store.mjs';
import { PostgresStatsStore } from './stats-store.mjs';
import { PostgresTeleportStore, MemoryTeleportStore } from './teleport-store.mjs';
import { PostgresNpcStore, MemoryNpcStore } from './npc-store.mjs';
import { PostgresQuestStore, MemoryQuestStore } from './quest-store.mjs';
import { PostgresResourceNodeStore, MemoryResourceNodeStore } from './resource-node-store.mjs';
import { PostgresSkillStore, MemorySkillStore } from './skill-store.mjs';
import { PostgresTitleStore, MemoryTitleStore } from './title-store.mjs';
import { PostgresFriendStore, MemoryFriendStore } from './friend-store.mjs';
import { PostgresGuildStore, MemoryGuildStore } from './guild-store.mjs';
import { renderPrometheusMetrics } from './metrics.mjs';
import { VERSION, LEGACY_VERSION, MAX_LINE, validateHello, validateEnroll, validateRecover, validatePairBrowserApprove, validateStatsConsent, validateStatsSnapshot, validateLinkJoin, validateLinkPacket, validateState, validateChat, validateEmote, validateTeleportLocations, validateTeleport, validateNpcInteract, validateQuestAccept, validateQuestClaim, validateQuestList, validateResourceInteract, validateTitleList, validateTitleEquip, validateFriendRequest, validateFriendAccept, validateFriendRemove, validateFriendList, validateGuildCreate, validateGuildJoin, validateGuildLeave, validateGuildDisband, validateGuildKick, validateGuildInfo, npcInteractDistance, encode } from './protocol.mjs';
import { listBuiltInDestinations, resolveBuiltInDestination } from './teleport-store.mjs';

export function createPresenceServer({ host = '0.0.0.0', port = 3210, idleMs = 30000, maxConnections = 64, maxConnectionsPerIp = 8, helloTimeoutMs = 5000, rosterIntervalMs = 1000, identityStore = null, statsStore = null, teleportStore = null, npcStore = null, questStore = null, resourceNodeStore = null, skillStore = null, titleStore = null, friendStore = null, guildStore = null } = {}) {
  const clients = new Map();
  const linkRooms = new Map();
  const rosterPageSize = 16;
  let rosterDirty = false;
  const metrics = { startedAt: Date.now(), totalConnections: 0, rejectedConnections: 0, ipRejectedConnections: 0, helloTimeouts: 0, enrollments: 0, recoveries: 0, authenticationFailures: 0, hellos: 0, states: 0, chats: 0, emotes: 0, statsConsents: 0, statsSnapshots: 0, linkJoins: 0, linkPackets: 0, linkLeaves: 0, linkRateLimited: 0, reconnectReplacements: 0, disconnects: 0 };
  const send = (socket, msg) => { if (!socket.destroyed) socket.write(encode(msg)); };
  const fail = (socket, code) => { send(socket, { type: 'error', code }); socket.end(); };
  const stableId = session => {
    const hex = crypto.createHash('sha256').update(`emerald-online-3ds:${session}`).digest('hex').slice(0, 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };
  const snapshot = (client) => {
    if (!client.state) return;
    const players = [...clients.values()].filter(c => c !== client && c.state?.map === client.state.map)
      .map(c => ({ id: c.id, name: c.name, title: c.title ?? '', guild_tag: c.guildTag ?? '', ...c.state }));
    send(client.socket, { type: 'snapshot', map: client.state.map, players });
  };
  const sendNpcSnapshot = async (client) => {
    if (!client.state || !npcStore) return;
    const npcs = await npcStore.listNpcsForMap(client.state.map);
    if (!npcs.length) return;
    send(client.socket, {
      type: 'npc_snapshot',
      map: client.state.map,
      npcs: npcs.map(npc => ({
        npc_id: npc.slug,
        name: npc.name,
        x: npc.x,
        y: npc.y,
        facing: npc.facing,
        sprite: npc.sprite,
        quest_id: npc.quest_id ?? null
      }))
    });
  };
  const sendResourceSnapshot = async (client) => {
    if (!client.state || !resourceNodeStore) return;
    const nodes = await resourceNodeStore.listNodesForMap(client.state.map);
    if (!nodes.length) return;
    send(client.socket, {
      type: 'resource_snapshot',
      map: client.state.map,
      nodes: nodes.map(node => ({
        node_id: node.slug,
        kind: node.kind,
        x: node.x,
        y: node.y,
        level: node.level,
        available: node.available,
        respawn_in_ms: node.respawn_in_ms
      }))
    });
  };
  const publishRosters = () => {
    if (!rosterDirty) return;
    rosterDirty = false;
    const users = [...clients.values()].filter(client => client.name).map(client => ({
      id: client.id,
      name: client.name,
      map: client.state?.map ?? '',
      x: client.state?.x ?? -1,
      y: client.state?.y ?? -1,
      role: client.isAdmin ? 'admin' : client.isModerator ? 'moderator' : 'player',
      guild_name: client.guildName ?? '',
      guild_tag: client.guildTag ?? ''
    })).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    const pages = Math.max(1, Math.ceil(users.length / rosterPageSize));
    for (const client of clients.values()) {
      if (!client.name) continue;
      for (let page = 0; page < pages; page++) {
        send(client.socket, {
          type: 'online_users',
          page,
          pages,
          total: users.length,
          users: users.slice(page * rosterPageSize, (page + 1) * rosterPageSize)
        });
      }
    }
  };
  const leaveLink = (client, reason = 'left') => {
    if (!client.linkRoom) return;
    const roomName = client.linkRoom;
    const room = linkRooms.get(roomName);
    const leavingId = client.linkClientId;
    client.linkRoom = null;
    client.linkClientId = null;
    client.linkPacketsAt = 0;
    client.linkPacketCount = 0;
    if (!room) return;
    room.members.delete(leavingId);
    metrics.linkLeaves++;
    if (leavingId === 0) {
      for (const peer of room.members.values()) {
        peer.linkRoom = null;
        peer.linkClientId = null;
        send(peer.socket, { type: 'link_ended', reason: 'host_left' });
      }
      linkRooms.delete(roomName);
      return;
    }
    const host = room.members.get(0);
    if (host) {
      send(host.socket, { type: 'link_peer_disconnected', clientId: leavingId, reason });
      send(host.socket, { type: 'link_waiting', room: roomName });
    } else linkRooms.delete(roomName);
  };
  const joinLink = (client, msg) => {
    if (!client.identityId || client.protocolVersion !== VERSION) return send(client.socket, { type: 'error', code: 'identity_required' });
    if (!validateLinkJoin(msg)) return send(client.socket, { type: 'error', code: 'invalid_link_join' });
    if (client.linkRoom) return send(client.socket, { type: 'error', code: 'already_in_link_room' });
    let room = linkRooms.get(msg.room);
    if (!room) {
      room = { core: msg.core, members: new Map() };
      linkRooms.set(msg.room, room);
    }
    if (room.core !== msg.core || room.members.size >= 2) return send(client.socket, { type: 'error', code: 'link_room_unavailable' });
    const clientId = room.members.has(0) ? 1 : 0;
    room.members.set(clientId, client);
    client.linkRoom = msg.room;
    client.linkClientId = clientId;
    client.linkPacketsAt = Date.now();
    client.linkPacketCount = 0;
    metrics.linkJoins++;
    if (room.members.size === 1) return send(client.socket, { type: 'link_waiting', room: msg.room });
    const host = room.members.get(0), guest = room.members.get(1);
    send(host.socket, { type: 'link_started', room: msg.room, clientId: 0, peerId: 1, core: msg.core });
    send(guest.socket, { type: 'link_started', room: msg.room, clientId: 1, peerId: 0, core: msg.core });
  };
  const relayLinkPacket = (client, msg) => {
    if (!validateLinkPacket(msg) || !client.linkRoom || client.linkClientId === null) return send(client.socket, { type: 'error', code: 'invalid_link_packet' });
    const room = linkRooms.get(client.linkRoom);
    if (!room || room.members.size !== 2) return send(client.socket, { type: 'error', code: 'link_not_ready' });
    const now = Date.now();
    if (now - client.linkPacketsAt >= 1000) { client.linkPacketsAt = now; client.linkPacketCount = 0; }
    if (++client.linkPacketCount > 240) {
      metrics.linkRateLimited++;
      if (client.linkPacketCount === 241) send(client.socket, { type: 'error', code: 'link_rate_limited' });
      return;
    }
    let delivered = 0;
    for (const [peerId, peer] of room.members) {
      if (peer === client || (msg.to !== 0xffff && msg.to !== peerId)) continue;
      send(peer.socket, { type: 'link_packet', from: client.linkClientId, data: msg.data });
      delivered++;
    }
    if (!delivered) return send(client.socket, { type: 'error', code: 'link_peer_unavailable' });
    metrics.linkPackets++;
  };
  const replaceCredentialConnection = client => {
    for (const peer of clients.values()) {
      const sameLegacy = client.session && peer.session === client.session;
      const sameCredential = client.credentialId && peer.credentialId === client.credentialId;
      if (peer !== client && (sameLegacy || sameCredential)) {
        send(peer.socket, { type: 'error', code: 'session_replaced' });
        peer.socket.end();
        metrics.reconnectReplacements++;
      }
    }
  };
  const finishAuthentication = async (client, msg, auth = {}) => {
    client.id = auth.identity_id ?? client.id;
    client.identityId = auth.identity_id ?? null;
    client.credentialId = auth.credential_id ?? null;
    client.fingerprint = auth.fingerprint ?? null;
    client.isAdmin = auth.is_admin === true;
    client.isModerator = auth.is_moderator === true;
    client.protocolVersion = msg.version;
    client.name = msg.name;
    client.avatar = msg.avatar === 'girl' ? 'girl' : 'boy';
    client.title = '';
    if (titleStore && client.identityId) {
      try { client.title = await titleStore.getEquippedTitle(client.identityId) ?? ''; } catch {}
    } else if (questStore && client.identityId) {
      try { client.title = await questStore.getEquippedTitle(client.identityId) ?? ''; } catch {}
    }
    if (guildStore && client.identityId) {
      try {
        const guild = await guildStore.getGuildForIdentity(client.identityId);
        client.guildName = guild?.name ?? '';
        client.guildTag = guild?.tag ?? '';
      } catch {}
    }
    if (client.helloTimer) clearTimeout(client.helloTimer);
    client.helloTimer = null;
    metrics.hellos++;
    replaceCredentialConnection(client);
    rosterDirty = true;
  };
  const playerDestination = (peer) => peer && peer.name && peer.state && peer.state.x >= 0 && peer.state.y >= 0
    ? { id: `player:${peer.id}`, name: peer.name, kind: 'player', map_group: peer.state.map.split('-')[0], map_num: peer.state.map.split('-')[1], x: peer.state.x, y: peer.state.y, facing: peer.state.facing }
    : null;
  const listTeleportDestinations = async (client) => {
    const destinations = listBuiltInDestinations();
    for (const peer of clients.values()) {
      if (peer !== client && peer.name) {
        const dest = playerDestination(peer);
        if (dest) destinations.push({ id: dest.id, name: dest.name, kind: dest.kind });
      }
    }
    const customVisible = client.isAdmin || client.isModerator;
    if (customVisible && teleportStore) {
      const custom = await teleportStore.listCustomDestinations();
      destinations.push(...custom);
    }
    return { destinations, customVisible };
  };
  const resolveTeleportDestination = async (client, destinationId) => {
    if (destinationId === 'mom') return resolveBuiltInDestination(destinationId);
    if (destinationId.startsWith('gym:') || destinationId.startsWith('location:')) return resolveBuiltInDestination(destinationId);
    if (destinationId.startsWith('player:')) {
      const peerId = destinationId.slice(7);
      const peer = [...clients.values()].find(c => c.id === peerId);
      return playerDestination(peer);
    }
    if (destinationId.startsWith('custom:')) {
      if (!client.isAdmin && !client.isModerator) return { unauthorized: true };
      return teleportStore ? await teleportStore.resolveCustomDestination(destinationId) : null;
    }
    return null;
  };
  const handleMessage = async (client, msg) => {
    const { socket } = client;
    if (!client.name) {
      if (validateEnroll(msg)) {
        if (!identityStore) return fail(socket, 'identity_unavailable');
        const enrollment = await identityStore.enroll({ withRecovery: msg.recovery === true });
        await finishAuthentication(client, msg, { identity_id: enrollment.identityId, credential_id: enrollment.credentialId, fingerprint: enrollment.fingerprint });
        metrics.enrollments++;
        send(socket, { type: 'enrolled', version: VERSION, id: enrollment.identityId, credentialId: enrollment.credentialId, token: enrollment.token, fingerprint: enrollment.fingerprint, role: enrollment.is_admin ? 'admin' : enrollment.is_moderator ? 'moderator' : 'player', ...(enrollment.recoveryCode ? { recoveryCode: enrollment.recoveryCode } : {}) });
        return;
      }
      if (validateRecover(msg)) {
        if (!identityStore) return fail(socket, 'identity_unavailable');
        const recovered = await identityStore.recover(msg.identity, msg.recoveryCode);
        if (!recovered) { metrics.authenticationFailures++; return fail(socket, 'recovery_failed'); }
        await finishAuthentication(client, msg, { identity_id: recovered.identityId, credential_id: recovered.credentialId, fingerprint: recovered.fingerprint });
        metrics.recoveries++;
        send(socket, { type: 'identity_recovered', version: VERSION, id: recovered.identityId, credentialId: recovered.credentialId, token: recovered.token, fingerprint: recovered.fingerprint, role: recovered.is_admin ? 'admin' : recovered.is_moderator ? 'moderator' : 'player' });
        return;
      }
      if (!validateHello(msg)) return fail(socket, 'invalid_hello');
      if (msg.version === VERSION) {
        if (!identityStore) return fail(socket, 'identity_unavailable');
        const auth = await identityStore.authenticate(msg.identity, msg.token);
        if (!auth) { metrics.authenticationFailures++; return fail(socket, 'authentication_failed'); }
        await finishAuthentication(client, msg, auth);
        send(socket, { type: 'welcome', version: VERSION, id: client.id, fingerprint: client.fingerprint, role: client.isAdmin ? 'admin' : client.isModerator ? 'moderator' : 'player', title: client.title ?? '' });
        return;
      }
      if (msg.version !== LEGACY_VERSION) return fail(socket, 'unsupported_version');
      if (msg.session) {
        client.session = msg.session.toLowerCase();
        client.id = stableId(client.session);
      }
      await finishAuthentication(client, msg);
      send(socket, { type: 'welcome', version: LEGACY_VERSION, latestVersion: VERSION, id: client.id });
      return;
    }
    if (msg.type === 'revoke_session') {
      if (!client.identityId || !client.credentialId || !identityStore) return fail(socket, 'identity_required');
      await identityStore.revoke(client.identityId, client.credentialId);
      send(socket, { type: 'session_revoked' });
      socket.end();
      return;
    }
    if (msg.type === 'export_identity') {
      if (!client.identityId || !identityStore) return send(socket, { type: 'error', code: 'identity_required' });
      send(socket, { type: 'identity_export', data: await identityStore.exportIdentity(client.identityId) });
      return;
    }
    if (msg.type === 'delete_identity') {
      if (!client.identityId || !identityStore || msg.confirm !== 'DELETE') return send(socket, { type: 'error', code: 'deletion_confirmation_required' });
      await identityStore.deleteIdentity(client.identityId);
      send(socket, { type: 'identity_deleted' });
      socket.end();
      return;
    }
    if (msg.type === 'pair_browser_approve') {
      if (!client.identityId || !client.credentialId || !identityStore) return send(socket, { type: 'error', code: 'identity_required' });
      if (!validatePairBrowserApprove(msg)) return send(socket, { type: 'error', code: 'invalid_pairing_code' });
      const approved = await identityStore.approvePairing(client.identityId, client.credentialId, msg.code);
      send(socket, approved ? { type: 'browser_pairing_approved', code: msg.code } : { type: 'error', code: 'pairing_code_unavailable' });
      return;
    }
    if (msg.type === 'stats_consent') {
      if (!client.identityId || !client.credentialId || !statsStore) return send(socket, { type: 'error', code: 'stats_unavailable' });
      if (!validateStatsConsent(msg)) return send(socket, { type: 'error', code: 'invalid_stats_consent' });
      const result = await statsStore.setConsent(client.identityId, client.credentialId, msg.enabled, msg.fields, msg.deleteHistory === true);
      if (!result) return send(socket, { type: 'error', code: 'stats_consent_failed' });
      metrics.statsConsents++;
      send(socket, { type: 'stats_consent_saved', ...result });
      return;
    }
    if (msg.type === 'stats_snapshot') {
      if (!client.identityId || !client.credentialId || !statsStore) return send(socket, { type: 'error', code: 'stats_unavailable' });
      if (!validateStatsSnapshot(msg)) return send(socket, { type: 'error', code: 'invalid_stats_snapshot' });
      const result = await statsStore.submitSnapshot(client.identityId, client.credentialId, msg);
      if (!result) return send(socket, { type: 'error', code: 'invalid_stats_snapshot' });
      if (!result.accepted) return send(socket, { type: 'error', code: result.error });
      metrics.statsSnapshots++;
      send(socket, { type: 'stats_snapshot_saved', count: result.entries.length, underReview: result.entries.filter(entry => entry.review_status === 'under-review').length });
      return;
    }
    if (msg.type === 'link_spike_join') { joinLink(client, msg); return; }
    if (msg.type === 'link_packet') { relayLinkPacket(client, msg); return; }
    if (msg.type === 'link_leave') { leaveLink(client, 'left'); send(socket, { type: 'link_left' }); return; }
    if (msg.type === 'ping') { send(socket, { type: 'pong', at: msg.at }); return; }
    if (msg.type === 'chat') {
      if (!client.state || !validateChat(msg)) return send(socket, { type: 'error', code: 'invalid_chat' });
      if (Date.now() - client.lastChat < 1000) return send(socket, { type: 'error', code: 'chat_rate_limited' });
      client.lastChat = Date.now();
      metrics.chats++;
      const scope = msg.scope === 'global' ? 'global' : 'map';
      const chat = { type: 'chat', scope, id: client.id, name: client.name, map: client.state.map, sentAt: new Date(client.lastChat).toISOString(), text: msg.text };
      for (const peer of clients.values()) {
        if (peer.name && peer.state && (scope === 'global' || peer.state.map === client.state.map)) send(peer.socket, chat);
      }
      return;
    }
    if (msg.type === 'emote') {
      if (!client.state || !validateEmote(msg)) return send(socket, { type: 'error', code: 'invalid_emote' });
      if (Date.now() - client.lastEmote < 2000) return send(socket, { type: 'error', code: 'emote_rate_limited' });
      client.lastEmote = Date.now();
      metrics.emotes++;
      const emote = { type: 'emote', id: client.id, name: client.name, map: client.state.map, emote: msg.emote };
      for (const peer of clients.values()) if (peer.name && peer.state?.map === client.state.map) send(peer.socket, emote);
      return;
    }
    if (msg.type === 'teleport_locations') {
      if (!validateTeleportLocations(msg)) return send(socket, { type: 'error', code: 'invalid_teleport_locations' });
      const { destinations, customVisible } = await listTeleportDestinations(client);
      send(socket, { type: 'teleport_locations', destinations, customVisible });
      return;
    }
    if (msg.type === 'teleport') {
      if (!validateTeleport(msg)) return send(socket, { type: 'error', code: 'invalid_teleport' });
      const destination = await resolveTeleportDestination(client, msg.destination_id);
      if (destination?.unauthorized) return send(socket, { type: 'teleport_result', ok: false, code: 'teleport_unauthorized' });
      if (!destination) return send(socket, { type: 'teleport_result', ok: false, code: 'teleport_not_found' });
      if (destination.kind === 'custom' && !client.isAdmin && !client.isModerator) return send(socket, { type: 'teleport_result', ok: false, code: 'teleport_unauthorized' });
      if (destination.kind === 'player' && (!destination.x || !destination.y)) return send(socket, { type: 'teleport_result', ok: false, code: 'teleport_player_unavailable' });
      if (teleportStore && client.identityId) await teleportStore.auditTeleport(client.identityId, msg.destination_id, { name: destination.name, kind: destination.kind });
      send(socket, {
        type: 'teleport_result',
        ok: true,
        map_group: Number(destination.map_group),
        map_num: Number(destination.map_num),
        x: Number(destination.x),
        y: Number(destination.y),
        facing: destination.facing ?? 'down'
      });
      return;
    }
    if (msg.type === 'npc_interact') {
      if (!client.state || !validateNpcInteract(msg)) return send(socket, { type: 'error', code: 'invalid_npc_interact' });
      if (!npcStore) return send(socket, { type: 'error', code: 'npc_unavailable' });
      const npc = await npcStore.findNpcBySlug(msg.npc_id);
      if (!npc || npc.map !== client.state.map || npcInteractDistance(client.state.x, client.state.y, npc.x, npc.y) > 2) {
        return send(socket, { type: 'error', code: 'npc_not_nearby' });
      }
      const questOffered = npc.quest_id && questStore ? await questStore.findQuestById(npc.quest_id) : null;
      const questUpdates = (client.identityId && questStore) ? await questStore.recordNpcInteraction(client.identityId, npc.slug) : [];
      send(socket, {
        type: 'npc_dialogue',
        npc_id: npc.slug,
        lines: npc.dialogue,
        quest_offered: questOffered ? { quest_id: questOffered.id, title: questOffered.title, description: questOffered.description } : null,
        quest_updates: questUpdates.map(q => ({ quest_id: q.quest_id, status: q.status }))
      });
      if (client.identityId) npcStore.auditNpcInteract(client.identityId, npc.slug).catch(() => {});
      return;
    }
    if (msg.type === 'quest_accept') {
      if (!client.identityId || !questStore) return send(socket, { type: 'error', code: 'quest_unavailable' });
      if (!validateQuestAccept(msg)) return send(socket, { type: 'error', code: 'invalid_quest_accept' });
      const result = await questStore.acceptQuest(client.identityId, msg.quest_id);
      if (result.error) return send(socket, { type: 'error', code: result.error });
      if (result.reward?.kind === 'title' && result.reward.data?.title) client.title = result.reward.data.title;
      send(socket, {
        type: 'quest_update',
        quest_id: result.quest.id,
        slug: result.quest.slug,
        title: result.quest.title,
        status: result.progress.status,
        progress: result.progress.progress,
        reward: result.reward ?? null
      });
      return;
    }
    if (msg.type === 'quest_claim') {
      if (!client.identityId || !questStore) return send(socket, { type: 'error', code: 'quest_unavailable' });
      if (!validateQuestClaim(msg)) return send(socket, { type: 'error', code: 'invalid_quest_claim' });
      const result = await questStore.claimReward(client.identityId, msg.quest_id);
      if (result.error) return send(socket, { type: 'error', code: result.error });
      if (result.reward?.kind === 'title' && result.reward.data?.title) client.title = result.reward.data.title;
      send(socket, {
        type: 'quest_update',
        quest_id: msg.quest_id,
        status: result.progress.status,
        progress: result.progress.progress,
        reward: result.reward ?? null
      });
      return;
    }
    if (msg.type === 'quest_list') {
      if (!client.identityId || !questStore) return send(socket, { type: 'error', code: 'quest_unavailable' });
      if (!validateQuestList(msg)) return send(socket, { type: 'error', code: 'invalid_quest_list' });
      const quests = await questStore.listQuestsForIdentity(client.identityId);
      send(socket, { type: 'quest_list', quests });
      return;
    }
    if (msg.type === 'title_list') {
      if (!client.identityId || !titleStore) return send(socket, { type: 'error', code: 'title_unavailable' });
      if (!validateTitleList(msg)) return send(socket, { type: 'error', code: 'invalid_title_list' });
      const titles = await titleStore.listTitles(client.identityId);
      send(socket, { type: 'title_list', titles });
      return;
    }
    if (msg.type === 'title_equip') {
      if (!client.identityId || !titleStore) return send(socket, { type: 'error', code: 'title_unavailable' });
      if (!validateTitleEquip(msg)) return send(socket, { type: 'error', code: 'invalid_title_equip' });
      const result = await titleStore.equipTitle(client.identityId, msg.title);
      if (result.error) return send(socket, { type: 'error', code: result.error });
      client.title = result.equipped;
      rosterDirty = true;
      send(socket, { type: 'title_equipped', title: result.equipped });
      return;
    }
    const sendFriendUpdate = async (identityId) => {
      if (!friendStore) return;
      const friends = await friendStore.listFriends(identityId);
      for (const peer of clients.values()) {
        if (!peer.identityId || peer.identityId === identityId) continue;
        const isFriend = friends.some(f => f.identity_id === peer.identityId && f.status === 'accepted');
        if (isFriend) send(peer.socket, { type: 'friend_update', identity_id: identityId, online: true });
      }
    };
    const sendGuildUpdate = async (guildId) => {
      if (!guildStore || !guildId) return;
      for (const peer of clients.values()) {
        if (!peer.identityId) continue;
        const membership = await guildStore.getGuildForIdentity(peer.identityId);
        if (membership?.id === guildId) send(peer.socket, { type: 'guild_update' });
      }
    };
    if (msg.type === 'friend_request') {
      if (!client.identityId || !friendStore) return send(socket, { type: 'error', code: 'friend_unavailable' });
      if (!validateFriendRequest(msg)) return send(socket, { type: 'error', code: 'invalid_friend_request' });
      const result = await friendStore.requestFriend(client.identityId, msg.fingerprint);
      if (result.error) return send(socket, { type: 'error', code: result.error });
      send(socket, { type: 'friend_result', fingerprint: msg.fingerprint, status: result.status });
      if (result.status === 'accepted') {
        const target = [...clients.values()].find(c => c.fingerprint === msg.fingerprint);
        if (target) {
          send(target.socket, { type: 'friend_result', fingerprint: client.fingerprint, status: 'accepted' });
          sendFriendUpdate(client.identityId);
          sendFriendUpdate(target.identityId);
        }
      }
      return;
    }
    if (msg.type === 'friend_accept') {
      if (!client.identityId || !friendStore) return send(socket, { type: 'error', code: 'friend_unavailable' });
      if (!validateFriendAccept(msg)) return send(socket, { type: 'error', code: 'invalid_friend_accept' });
      const result = await friendStore.acceptFriend(client.identityId, msg.fingerprint);
      if (result.error) return send(socket, { type: 'error', code: result.error });
      send(socket, { type: 'friend_result', fingerprint: msg.fingerprint, status: result.status });
      const target = [...clients.values()].find(c => c.fingerprint === msg.fingerprint);
      if (target) {
        send(target.socket, { type: 'friend_result', fingerprint: client.fingerprint, status: 'accepted' });
        sendFriendUpdate(client.identityId);
        sendFriendUpdate(target.identityId);
      }
      return;
    }
    if (msg.type === 'friend_remove') {
      if (!client.identityId || !friendStore) return send(socket, { type: 'error', code: 'friend_unavailable' });
      if (!validateFriendRemove(msg)) return send(socket, { type: 'error', code: 'invalid_friend_remove' });
      const result = await friendStore.removeFriend(client.identityId, msg.fingerprint);
      if (result.error) return send(socket, { type: 'error', code: result.error });
      send(socket, { type: 'friend_removed', fingerprint: msg.fingerprint });
      const target = [...clients.values()].find(c => c.fingerprint === msg.fingerprint);
      if (target) send(target.socket, { type: 'friend_removed', fingerprint: client.fingerprint });
      return;
    }
    if (msg.type === 'friend_list') {
      if (!client.identityId || !friendStore) return send(socket, { type: 'error', code: 'friend_unavailable' });
      if (!validateFriendList(msg)) return send(socket, { type: 'error', code: 'invalid_friend_list' });
      const friends = await friendStore.listFriends(client.identityId);
      const enriched = friends.map(f => {
        const peer = [...clients.values()].find(c => c.identityId === f.identity_id);
        return {
          fingerprint: peer?.fingerprint ?? '',
          name: peer?.name ?? '',
          status: f.status,
          is_requester: f.is_requester,
          online: Boolean(peer?.name),
          map: peer?.state?.map ?? '',
          x: peer?.state?.x ?? -1,
          y: peer?.state?.y ?? -1
        };
      });
      send(socket, { type: 'friend_list', friends: enriched });
      return;
    }
    if (msg.type === 'guild_create') {
      if (!client.identityId || !guildStore) return send(socket, { type: 'error', code: 'guild_unavailable' });
      if (!validateGuildCreate(msg)) return send(socket, { type: 'error', code: 'invalid_guild_create' });
      const result = await guildStore.createGuild(client.identityId, msg.name, msg.tag);
      if (result.error) return send(socket, { type: 'error', code: result.error });
      client.guildName = result.guild.name;
      client.guildTag = result.guild.tag;
      rosterDirty = true;
      const info = await guildStore.getGuildInfo(client.identityId);
      send(socket, { type: 'guild_info', ...info });
      return;
    }
    if (msg.type === 'guild_join') {
      if (!client.identityId || !guildStore) return send(socket, { type: 'error', code: 'guild_unavailable' });
      if (!validateGuildJoin(msg)) return send(socket, { type: 'error', code: 'invalid_guild_join' });
      const result = await guildStore.joinGuild(client.identityId, msg.name);
      if (result.error) return send(socket, { type: 'error', code: result.error });
      client.guildName = result.guild.name;
      client.guildTag = result.guild.tag;
      rosterDirty = true;
      sendGuildUpdate(result.guild.id);
      const info = await guildStore.getGuildInfo(client.identityId);
      send(socket, { type: 'guild_info', ...info });
      return;
    }
    if (msg.type === 'guild_leave') {
      if (!client.identityId || !guildStore) return send(socket, { type: 'error', code: 'guild_unavailable' });
      if (!validateGuildLeave(msg)) return send(socket, { type: 'error', code: 'invalid_guild_leave' });
      const result = await guildStore.leaveGuild(client.identityId);
      if (result.error) return send(socket, { type: 'error', code: result.error });
      const oldGuildId = client.guildName ? result.guild_id : null;
      client.guildName = '';
      client.guildTag = '';
      rosterDirty = true;
      if (oldGuildId) sendGuildUpdate(oldGuildId);
      send(socket, { type: 'guild_left' });
      return;
    }
    if (msg.type === 'guild_disband') {
      if (!client.identityId || !guildStore) return send(socket, { type: 'error', code: 'guild_unavailable' });
      if (!validateGuildDisband(msg)) return send(socket, { type: 'error', code: 'invalid_guild_disband' });
      const info = await guildStore.getGuildInfo(client.identityId);
      const result = await guildStore.disbandGuild(client.identityId);
      if (result.error) return send(socket, { type: 'error', code: result.error });
      client.guildName = '';
      client.guildTag = '';
      rosterDirty = true;
      if (info.guild) sendGuildUpdate(info.guild.id);
      send(socket, { type: 'guild_disbanded' });
      return;
    }
    if (msg.type === 'guild_kick') {
      if (!client.identityId || !guildStore) return send(socket, { type: 'error', code: 'guild_unavailable' });
      if (!validateGuildKick(msg)) return send(socket, { type: 'error', code: 'invalid_guild_kick' });
      const info = await guildStore.getGuildInfo(client.identityId);
      const result = await guildStore.kickMember(client.identityId, msg.fingerprint);
      if (result.error) return send(socket, { type: 'error', code: result.error });
      if (info.guild) sendGuildUpdate(info.guild.id);
      const target = [...clients.values()].find(c => c.fingerprint === msg.fingerprint);
      if (target) {
        target.guildName = '';
        target.guildTag = '';
        send(target.socket, { type: 'guild_kicked' });
      }
      rosterDirty = true;
      send(socket, { type: 'guild_kick_ok', fingerprint: msg.fingerprint });
      return;
    }
    if (msg.type === 'guild_info') {
      if (!client.identityId || !guildStore) return send(socket, { type: 'error', code: 'guild_unavailable' });
      if (!validateGuildInfo(msg)) return send(socket, { type: 'error', code: 'invalid_guild_info' });
      const info = await guildStore.getGuildInfo(client.identityId);
      send(socket, { type: 'guild_info', ...info });
      return;
    }
    if (msg.type === 'resource_interact') {
      if (!client.identityId || !resourceNodeStore || !questStore) return send(socket, { type: 'error', code: 'resource_unavailable' });
      if (!client.state) return send(socket, { type: 'error', code: 'resource_no_position' });
      if (!validateResourceInteract(msg)) return send(socket, { type: 'error', code: 'invalid_resource_interact' });
      const node = await resourceNodeStore.findNodeBySlug(msg.node_id);
      if (!node) return send(socket, { type: 'error', code: 'resource_not_found' });
      if (node.map !== client.state.map) return send(socket, { type: 'error', code: 'resource_wrong_map' });
      if (npcInteractDistance(client.state.x, client.state.y, node.x, node.y) > 2) return send(socket, { type: 'error', code: 'resource_too_far' });
      if (!node.available) return send(socket, { type: 'resource_interact_result', ok: false, node_id: node.slug, reason: 'resource_respawning', respawn_in_ms: node.respawn_in_ms });
      const harvested = await resourceNodeStore.harvestNode(node.slug);
      if (!harvested) return send(socket, { type: 'resource_interact_result', ok: false, node_id: node.slug, reason: 'resource_unavailable' });
      const skill = { tree: 'woodcutting', rock: 'mining', water: 'fishing' }[node.kind];
      let skillUpdate = null;
      if (skillStore && skill) skillUpdate = await skillStore.addXp(client.identityId, skill, 10);
      const questUpdates = await questStore.recordResourceInteraction(client.identityId, node.slug);
      send(socket, {
        type: 'resource_interact_result',
        ok: true,
        node_id: node.slug,
        kind: node.kind,
        skill: skillUpdate ? { skill: skillUpdate.skill, xp: skillUpdate.xp, level: skillUpdate.level } : null,
        quest_updates: questUpdates.map(q => ({ quest_id: q.quest_id, status: q.status }))
      });
      return;
    }
    if (msg.type !== 'state') return send(socket, { type: 'error', code: 'unknown_type' });
    if (!validateState(msg, client.seq)) return fail(socket, 'invalid_state');
    client.seq = msg.seq;
    client.state = { map: msg.map, x: msg.x, y: msg.y, facing: msg.facing, avatar: msg.avatar === 'girl' ? 'girl' : client.avatar };
    metrics.states++;
    rosterDirty = true;
    for (const peer of clients.values()) if (peer.name) snapshot(peer);
    sendNpcSnapshot(client).catch(() => {});
    sendResourceSnapshot(client).catch(() => {});
  };
  const server = net.createServer(socket => {
    metrics.totalConnections++;
    if (clients.size >= maxConnections) { metrics.rejectedConnections++; fail(socket, 'server_full'); return; }
    const remoteAddress = socket.remoteAddress ?? 'unknown';
    const sameIp = [...clients.values()].filter(existing => existing.remoteAddress === remoteAddress).length;
    if (sameIp >= maxConnectionsPerIp) { metrics.ipRejectedConnections++; fail(socket, 'ip_connection_limit'); return; }
    const client = { id: crypto.randomUUID(), identityId: null, credentialId: null, fingerprint: null, protocolVersion: null, session: null, socket, remoteAddress, buffer: '', name: null, avatar: 'boy', state: null, seq: -1, seen: Date.now(), lastChat: 0, lastEmote: 0, linkRoom: null, linkClientId: null, linkPacketsAt: 0, linkPacketCount: 0, helloTimer: null, processing: Promise.resolve(), guildName: '', guildTag: '' };
    clients.set(socket, client);
    client.helloTimer = setTimeout(() => {
      if (!client.name) {
        metrics.helloTimeouts++;
        fail(socket, 'hello_timeout');
      }
    }, helloTimeoutMs);
    client.helloTimer.unref();
    socket.setNoDelay(true);
    socket.on('data', chunk => {
      client.seen = Date.now(); client.buffer += chunk.toString('utf8');
      if (Buffer.byteLength(client.buffer) > MAX_LINE && !client.buffer.includes('\n')) return fail(socket, 'line_too_long');
      let newline;
      while ((newline = client.buffer.indexOf('\n')) >= 0) {
        const line = client.buffer.slice(0, newline); client.buffer = client.buffer.slice(newline + 1);
        if (Buffer.byteLength(line) > MAX_LINE) return fail(socket, 'line_too_long');
        let msg; try { msg = JSON.parse(line); } catch { fail(socket, 'invalid_json'); return; }
        client.processing = client.processing.then(() => handleMessage(client, msg)).catch(() => fail(socket, 'internal_error'));
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => { if (client.helloTimer) clearTimeout(client.helloTimer); leaveLink(client, 'disconnected'); if (clients.delete(socket)) { metrics.disconnects++; rosterDirty = true; publishRosters(); } for (const peer of clients.values()) snapshot(peer); });
  });
  const timer = setInterval(() => { const cutoff = Date.now() - idleMs; for (const c of clients.values()) if (c.seen < cutoff) c.socket.destroy(); }, Math.min(idleMs, 5000));
  const rosterTimer = setInterval(publishRosters, rosterIntervalMs);
  timer.unref(); rosterTimer.unref(); server.on('close', () => { clearInterval(timer); clearInterval(rosterTimer); });
	const status = () => ({
		uptimeSeconds: Math.floor((Date.now() - metrics.startedAt) / 1000),
		connections: clients.size,
		authenticated: [...clients.values()].filter(client => client.name).length,
		positioned: [...clients.values()].filter(client => client.state).length,
		rooms: new Set([...clients.values()].flatMap(client => client.state ? [client.state.map] : [])).size,
		linkRooms: linkRooms.size,
		linkPlayers: [...linkRooms.values()].reduce((sum, room) => sum + room.members.size, 0),
		capacity: maxConnections,
		...metrics
	});
  return { server, clients, metrics, status };
}

export async function startServers({ identityStore: identityStoreOverride = null, statsStore: statsStoreOverride = null, teleportStore: teleportStoreOverride = null } = {}) {
  const host = process.env.GAME_HOST ?? '0.0.0.0';
  const port = Number(process.env.GAME_PORT ?? 3210);
  const healthPort = Number(process.env.HEALTH_PORT ?? 3211);
  const idleMs = Number(process.env.IDLE_MS ?? 30000);
  const maxConnections = Number(process.env.MAX_CONNECTIONS ?? 64);
  const maxConnectionsPerIp = Number(process.env.MAX_CONNECTIONS_PER_IP ?? 8);
  const helloTimeoutMs = Number(process.env.HELLO_TIMEOUT_MS ?? 5000);
  if (![port, healthPort, idleMs, maxConnections, maxConnectionsPerIp, helloTimeoutMs].every(Number.isSafeInteger) ||
      port < 1 || port > 65535 || healthPort < 1 || healthPort > 65535 ||
      idleMs < 5000 || maxConnections < 1 || maxConnectionsPerIp < 1 || helloTimeoutMs < 1000) throw new Error('invalid server configuration');
  let pool = null;
  let identityStore = identityStoreOverride;
  let statsStore = statsStoreOverride;
  let teleportStore = teleportStoreOverride;
  let npcStore = null;
  let questStore = null;
  let resourceNodeStore = null;
  let skillStore = null;
  let titleStore = null;
  let friendStore = null;
  let guildStore = null;
  const databaseConfig = process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : process.env.PGHOST
      ? { host: process.env.PGHOST, port: Number(process.env.PGPORT ?? 5432), database: process.env.PGDATABASE, user: process.env.PGUSER, password: process.env.PGPASSWORD }
      : null;
  if (databaseConfig) {
    const ssl = process.env.DATABASE_CA_PATH
      ? { ca: fs.readFileSync(process.env.DATABASE_CA_PATH, 'utf8'), rejectUnauthorized: true }
      : undefined;
    pool = new pg.Pool({ ...databaseConfig, max: Number(process.env.DATABASE_POOL_SIZE ?? 10), ssl });
    await pool.query('SELECT 1');
    identityStore = new PostgresIdentityStore(pool, process.env.IDENTITY_PEPPER);
    statsStore = new PostgresStatsStore(pool);
    if (!teleportStore) teleportStore = new PostgresTeleportStore(pool);
    npcStore = new PostgresNpcStore(pool);
    titleStore = new PostgresTitleStore(pool);
    questStore = new PostgresQuestStore(pool, titleStore);
    resourceNodeStore = new PostgresResourceNodeStore(pool);
    skillStore = new PostgresSkillStore(pool);
    friendStore = new PostgresFriendStore(pool, fingerprint => identityStore.findByFingerprint(fingerprint));
    guildStore = new PostgresGuildStore(pool, fingerprint => identityStore.findByFingerprint(fingerprint));
  }
  if (!teleportStore) teleportStore = new MemoryTeleportStore();
  if (!npcStore) npcStore = new MemoryNpcStore();
  if (!titleStore) titleStore = new MemoryTitleStore();
  if (!questStore) questStore = new MemoryQuestStore(titleStore);
  if (!resourceNodeStore) resourceNodeStore = new MemoryResourceNodeStore();
  if (!skillStore) skillStore = new MemorySkillStore();
  if (!friendStore) friendStore = new MemoryFriendStore(fingerprint => identityStore.findByFingerprint(fingerprint));
  if (!guildStore) guildStore = new MemoryGuildStore(fingerprint => identityStore.findByFingerprint(fingerprint));
  if (!pool) {
    // Seed the in-memory stores with the Phase 1 welcome quest and scientist NPC
    // so development/test runs without a database mirror the migration defaults.
    const seededQuest = await questStore.findQuestBySlug('welcome-to-hoenn-online');
    if (!seededQuest) {
      const questId = crypto.randomUUID();
      questStore.setQuest({
        id: questId,
        slug: 'welcome-to-hoenn-online',
        title: 'Welcome to Hoenn Online',
        description: 'The scientist in Littleroot needs your help testing the online connection.',
        requirements: [],
        reward_kind: 'title',
        reward_data: { title: 'Beta Pioneer' },
        active: true
      });
      const npc = await npcStore.findNpcBySlug('scientist-welcome');
      if (npc) npcStore.setNpc('scientist-welcome', { ...npc, map: '0-9', quest_id: questId });
      // Seed Phase 4 resource node and extended quest chain.
      if (!await resourceNodeStore.findNodeBySlug('littleroot-apple-tree')) {
        resourceNodeStore.setNode('littleroot-apple-tree', {
          id: 'littleroot-apple-tree', kind: 'tree', map: '0-9', x: 12, y: 13, level: 1, respawn_seconds: 30, active: true
        });
      }
      if (!await questStore.findQuestBySlug('field-research')) {
        questStore.setQuest({
          id: crypto.randomUUID(),
          slug: 'field-research',
          title: 'Field Research',
          description: 'The scientist wants a sample from a nearby resource node. Interact with the apple tree just west of the lab.',
          requirements: [{ kind: 'quest_completed', quest_id: questId }, { kind: 'interact_resource', node_id: 'littleroot-apple-tree' }],
          reward_kind: 'title',
          reward_data: { title: 'Beta Pioneer II' },
          active: true
        });
      }
      if (!await questStore.findQuestBySlug('report-findings')) {
        const fieldQuest = await questStore.findQuestBySlug('field-research');
        if (fieldQuest) {
          questStore.setQuest({
            id: crypto.randomUUID(),
            slug: 'report-findings',
            title: 'Report Findings',
            description: 'Return to the scientist with the sample.',
            requirements: [{ kind: 'quest_completed', quest_id: fieldQuest.id }, { kind: 'talk_to_npc', npc_id: 'scientist-welcome' }],
            reward_kind: 'title',
            reward_data: { title: 'Research Assistant' },
            active: true
          });
        }
      }
    }
  }
  const presence = createPresenceServer({ host, port, idleMs, maxConnections, maxConnectionsPerIp, helloTimeoutMs, identityStore, statsStore, teleportStore, npcStore, questStore, resourceNodeStore, skillStore, titleStore, friendStore, guildStore });
  await new Promise(resolve => presence.server.listen(port, host, resolve));
  const health = http.createServer((req, res) => {
    if (req.url === '/metrics') {
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8', 'cache-control': 'no-store' });
      res.end(renderPrometheusMetrics(presence.status(), { protocol: VERSION, databaseReady: Boolean(pool) }));
      return;
    }
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, protocol: VERSION, database: pool ? 'ready' : 'disabled', ...presence.status() }));
      return;
    }
    if (req.url === '/debug/clients' && (req.socket.remoteAddress === '127.0.0.1' || req.socket.remoteAddress === '::1' || req.socket.remoteAddress === '::ffff:127.0.0.1')) {
      const clients = [...presence.clients.values()].filter(client => client.name)
        .map(client => ({ name: client.name, state: client.state }));
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ clients }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise(resolve => health.listen(healthPort, host, resolve));
  console.log(`presence tcp://${host}:${port}; health http://${host}:${healthPort}/health`);
  const closeServer = server => new Promise(resolve => server.close(resolve));
  const shutdown = async () => {
    for (const client of presence.clients.values()) {
      sendShutdown(client.socket);
      client.socket.end();
    }
    await Promise.all([closeServer(presence.server), closeServer(health)]);
    if (pool) await pool.end();
  };
  return { presence, health, pool, shutdown };
}

function sendShutdown(socket) {
  if (!socket.destroyed) socket.write(encode({ type: 'error', code: 'server_restarting' }));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const running = await startServers();
  let stopping = false;
  const stop = signal => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: draining clients and stopping`);
    const force = setTimeout(() => process.exit(1), 8000);
    force.unref();
    running.shutdown().then(() => process.exit(0), error => {
      console.error(error);
      process.exit(1);
    });
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
}
