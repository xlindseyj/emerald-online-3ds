import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import WebSocket from 'ws';

const endpoint = process.env.GAME_PUBLIC_URL ?? 'wss://live.emeraldonline3ds.com/game';
const healthUrl = process.env.HEALTH_URL ?? 'https://live.emeraldonline3ds.com/health';
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const roomBytes = crypto.randomBytes(8);
const room = [...roomBytes].map(value => alphabet[value % alphabet.length]).slice(0, 4).join('') + '-' +
  [...roomBytes].map(value => alphabet[(value >> 3) % alphabet.length]).slice(0, 4).join('');
const delayPattern = [0, 3, 17, 41, 8, 29, 1, 53, 12, 35];
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

class Client {
  constructor(name) { this.name = name; this.queue = []; this.waiters = []; }
  async connect() {
    this.socket = new WebSocket(endpoint);
    this.socket.on('message', data => {
      for (const line of data.toString().split('\n').filter(Boolean)) this.queue.push(JSON.parse(line));
      for (const wake of this.waiters.splice(0)) wake();
    });
    await new Promise((resolve, reject) => { this.socket.once('open', resolve); this.socket.once('error', reject); });
  }
  send(message) { this.socket.send(`${JSON.stringify(message)}\n`); }
  async next(predicate, timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.queue.findIndex(predicate);
      if (index >= 0) return this.queue.splice(index, 1)[0];
      if (Date.now() >= deadline) throw new Error(`${this.name}: message timeout`);
      await Promise.race([new Promise(resolve => this.waiters.push(resolve)), wait(Math.min(100, deadline - Date.now()))]);
    }
  }
  async enroll() {
    this.send({ type: 'enroll', version: 2, name: this.name, avatar: 'girl' });
    const enrolled = await this.next(message => message.type === 'enrolled');
    this.identity = enrolled.id; this.token = enrolled.token;
  }
  async authenticate() {
    this.send({ type: 'hello', version: 2, name: this.name, identity: this.identity, token: this.token, avatar: 'girl' });
    await this.next(message => message.type === 'welcome');
  }
  join() { this.send({ type: 'link_spike_join', room, core: 'gpSP v1.0' }); }
  async deleteIdentity() {
    if (!this.identity || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.send({ type: 'delete_identity', confirm: 'DELETE' });
    await this.next(message => message.type === 'identity_deleted').catch(() => {});
    this.identity = null;
  }
}

const before = await fetch(healthUrl).then(response => response.json());
const host = new Client('LinkHost'), guest = new Client('LinkGuest');
let sent = 0, intentionallyOmitted = 0;
const roundTrips = [];
try {
  await Promise.all([host.connect(), guest.connect()]);
  await Promise.all([host.enroll(), guest.enroll()]);
  host.join();
  assert.equal((await host.next(message => message.type === 'link_waiting')).room, room);
  guest.join();
  assert.equal((await host.next(message => message.type === 'link_started')).clientId, 0);
  assert.equal((await guest.next(message => message.type === 'link_started')).clientId, 1);

  for (let sequence = 0; sequence < 30; ++sequence) {
    await wait(delayPattern[sequence % delayPattern.length]);
    if (sequence % 7 === 6) { intentionallyOmitted++; continue; }
    const payload = Buffer.alloc(16);
    payload.writeUInt32BE(0x4d504b31, 0); // Serial-Poke MPK1 marker
    payload.writeUInt32BE(sequence, 4);
    crypto.randomFillSync(payload, 8);
    const data = payload.toString('hex'), started = performance.now();
    host.send({ type: 'link_packet', to: 0xffff, data }); sent++;
    const relayed = await guest.next(message => message.type === 'link_packet' && message.data === data);
    assert.equal(relayed.from, 0);
    guest.send({ type: 'link_packet', to: 0, data });
    await host.next(message => message.type === 'link_packet' && message.data === data);
    roundTrips.push(performance.now() - started);
  }

  guest.socket.terminate();
  assert.equal((await host.next(message => message.type === 'link_peer_disconnected', 15000)).clientId, 1);
  await host.next(message => message.type === 'link_waiting');
  guest.queue = [];
  await guest.connect();
  await guest.authenticate();
  guest.join();
  await Promise.all([
    host.next(message => message.type === 'link_started'),
    guest.next(message => message.type === 'link_started')
  ]);
  const reconnectData = Buffer.from('4d504b31feedface', 'hex').toString('hex');
  guest.send({ type: 'link_packet', to: 0, data: reconnectData });
  assert.equal((await host.next(message => message.type === 'link_packet' && message.data === reconnectData)).from, 1);

  await guest.deleteIdentity();
  await host.deleteIdentity();
  const after = await fetch(healthUrl).then(response => response.json());
  const average = roundTrips.reduce((sum, value) => sum + value, 0) / roundTrips.length;
  const jitter = roundTrips.slice(1).reduce((sum, value, index) => sum + Math.abs(value - roundTrips[index]), 0) / Math.max(1, roundTrips.length - 1);
  console.log(JSON.stringify({ ok: true, endpoint, room, deliveredSyntheticPackets: sent * 2 + 1,
    intentionallyOmittedBeforeTransport: intentionallyOmitted, reconnectPassed: true,
    roundTripMs: { minimum: Math.min(...roundTrips), average, maximum: Math.max(...roundTrips), meanAbsoluteJitter: jitter },
    serverMetricsDelta: { linkJoins: after.linkJoins - before.linkJoins, linkPackets: after.linkPackets - before.linkPackets, linkLeaves: after.linkLeaves - before.linkLeaves },
    syntheticIdentitiesDeleted: true,
    limitation: 'Reliable WSS relay and reconnect passed; omission before transport is not proof of Cable Club tolerance to network loss.' }));
} catch (error) {
  await guest.deleteIdentity().catch(() => {});
  await host.deleteIdentity().catch(() => {});
  throw error;
} finally {
  host.socket?.terminate(); guest.socket?.terminate();
}
