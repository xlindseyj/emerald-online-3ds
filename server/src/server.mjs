import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { PostgresIdentityStore } from './identity-store.mjs';
import { PostgresStatsStore } from './stats-store.mjs';
import { VERSION, LEGACY_VERSION, MAX_LINE, validateHello, validateEnroll, validateRecover, validatePairBrowserApprove, validateStatsConsent, validateStatsSnapshot, validateLinkJoin, validateLinkPacket, validateState, validateChat, validateEmote, encode } from './protocol.mjs';

export function createPresenceServer({ host = '0.0.0.0', port = 3210, idleMs = 30000, maxConnections = 64, maxConnectionsPerIp = 8, helloTimeoutMs = 5000, identityStore = null, statsStore = null } = {}) {
  const clients = new Map();
  const linkRooms = new Map();
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
      .map(c => ({ id: c.id, name: c.name, ...c.state }));
    send(client.socket, { type: 'snapshot', map: client.state.map, players });
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
  const finishAuthentication = (client, msg, auth = {}) => {
    client.id = auth.identity_id ?? client.id;
    client.identityId = auth.identity_id ?? null;
    client.credentialId = auth.credential_id ?? null;
    client.fingerprint = auth.fingerprint ?? null;
    client.protocolVersion = msg.version;
    client.name = msg.name;
    client.avatar = msg.avatar === 'girl' ? 'girl' : 'boy';
    if (client.helloTimer) clearTimeout(client.helloTimer);
    client.helloTimer = null;
    metrics.hellos++;
    replaceCredentialConnection(client);
  };
  const handleMessage = async (client, msg) => {
    const { socket } = client;
    if (!client.name) {
      if (validateEnroll(msg)) {
        if (!identityStore) return fail(socket, 'identity_unavailable');
        const enrollment = await identityStore.enroll({ withRecovery: msg.recovery === true });
        finishAuthentication(client, msg, { identity_id: enrollment.identityId, credential_id: enrollment.credentialId, fingerprint: enrollment.fingerprint });
        metrics.enrollments++;
        send(socket, { type: 'enrolled', version: VERSION, id: enrollment.identityId, credentialId: enrollment.credentialId, token: enrollment.token, fingerprint: enrollment.fingerprint, ...(enrollment.recoveryCode ? { recoveryCode: enrollment.recoveryCode } : {}) });
        return;
      }
      if (validateRecover(msg)) {
        if (!identityStore) return fail(socket, 'identity_unavailable');
        const recovered = await identityStore.recover(msg.identity, msg.recoveryCode);
        if (!recovered) { metrics.authenticationFailures++; return fail(socket, 'recovery_failed'); }
        finishAuthentication(client, msg, { identity_id: recovered.identityId, credential_id: recovered.credentialId, fingerprint: recovered.fingerprint });
        metrics.recoveries++;
        send(socket, { type: 'identity_recovered', version: VERSION, id: recovered.identityId, credentialId: recovered.credentialId, token: recovered.token, fingerprint: recovered.fingerprint });
        return;
      }
      if (!validateHello(msg)) return fail(socket, 'invalid_hello');
      if (msg.version === VERSION) {
        if (!identityStore) return fail(socket, 'identity_unavailable');
        const auth = await identityStore.authenticate(msg.identity, msg.token);
        if (!auth) { metrics.authenticationFailures++; return fail(socket, 'authentication_failed'); }
        finishAuthentication(client, msg, auth);
        send(socket, { type: 'welcome', version: VERSION, id: client.id, fingerprint: client.fingerprint });
        return;
      }
      if (msg.version !== LEGACY_VERSION) return fail(socket, 'unsupported_version');
      if (msg.session) {
        client.session = msg.session.toLowerCase();
        client.id = stableId(client.session);
      }
      finishAuthentication(client, msg);
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
      const chat = { type: 'chat', id: client.id, name: client.name, map: client.state.map, text: msg.text };
      for (const peer of clients.values()) if (peer.name && peer.state?.map === client.state.map) send(peer.socket, chat);
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
    if (!validateState(msg, client.seq)) return fail(socket, 'invalid_state');
    client.seq = msg.seq;
    client.state = { map: msg.map, x: msg.x, y: msg.y, facing: msg.facing, avatar: msg.avatar === 'girl' ? 'girl' : client.avatar };
    metrics.states++;
    for (const peer of clients.values()) if (peer.name) snapshot(peer);
  };
  const server = net.createServer(socket => {
    metrics.totalConnections++;
    if (clients.size >= maxConnections) { metrics.rejectedConnections++; fail(socket, 'server_full'); return; }
    const remoteAddress = socket.remoteAddress ?? 'unknown';
    const sameIp = [...clients.values()].filter(existing => existing.remoteAddress === remoteAddress).length;
    if (sameIp >= maxConnectionsPerIp) { metrics.ipRejectedConnections++; fail(socket, 'ip_connection_limit'); return; }
    const client = { id: crypto.randomUUID(), identityId: null, credentialId: null, fingerprint: null, protocolVersion: null, session: null, socket, remoteAddress, buffer: '', name: null, avatar: 'boy', state: null, seq: -1, seen: Date.now(), lastChat: 0, lastEmote: 0, linkRoom: null, linkClientId: null, linkPacketsAt: 0, linkPacketCount: 0, helloTimer: null, processing: Promise.resolve() };
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
    socket.on('close', () => { if (client.helloTimer) clearTimeout(client.helloTimer); leaveLink(client, 'disconnected'); if (clients.delete(socket)) metrics.disconnects++; for (const peer of clients.values()) snapshot(peer); });
  });
  const timer = setInterval(() => { const cutoff = Date.now() - idleMs; for (const c of clients.values()) if (c.seen < cutoff) c.socket.destroy(); }, Math.min(idleMs, 5000));
  timer.unref(); server.on('close', () => clearInterval(timer));
	const status = () => ({
		uptimeSeconds: Math.floor((Date.now() - metrics.startedAt) / 1000),
		connections: clients.size,
		authenticated: [...clients.values()].filter(client => client.name).length,
		positioned: [...clients.values()].filter(client => client.state).length,
		rooms: new Set([...clients.values()].flatMap(client => client.state ? [client.state.map] : [])).size,
		linkRooms: linkRooms.size,
		linkPlayers: [...linkRooms.values()].reduce((sum, room) => sum + room.members.size, 0),
		...metrics
	});
  return { server, clients, metrics, status };
}

export async function startServers({ identityStore: identityStoreOverride = null, statsStore: statsStoreOverride = null } = {}) {
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
  }
  const presence = createPresenceServer({ host, port, idleMs, maxConnections, maxConnectionsPerIp, helloTimeoutMs, identityStore, statsStore });
  await new Promise(resolve => presence.server.listen(port, host, resolve));
  const health = http.createServer((req, res) => {
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
