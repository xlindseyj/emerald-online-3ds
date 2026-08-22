import crypto from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const loopback = host => ['127.0.0.1', 'localhost', '::1'].includes(host);

function integer(value, name, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`${name} must be ${minimum}-${maximum}`);
  return parsed;
}

async function health(url) {
  if (!url) return null;
  const response = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error(`health endpoint returned ${response.status}`);
  return response.json();
}

export async function runLoadTest({ host = '127.0.0.1', port = 3210, clients = 24, durationMs = 10000, rateHz = 5, healthUrl = null, allowRemote = false } = {}) {
  port = integer(port, 'port', 1, 65535);
  clients = integer(clients, 'clients', 1, 48);
  durationMs = integer(durationMs, 'durationMs', 1000, 60000);
  rateHz = integer(rateHz, 'rateHz', 1, 10);
  if (!loopback(host) && !allowRemote) throw new Error('remote load tests require ALLOW_REMOTE_LOAD_TEST=YES');

  const before = await health(healthUrl);
  const peers = [];
  const helloLatencies = [];
  const protocolErrors = [];
  let snapshots = 0, pongs = 0, statesSent = 0;
  const connectOne = index => new Promise((resolve, reject) => {
    const started = performance.now();
    const socket = net.createConnection({ host, port });
    const peer = { socket, buffer: '', seq: -1 };
    peers.push(peer);
    const timeout = setTimeout(() => reject(new Error(`client ${index} welcome timeout`)), 5000);
    timeout.unref();
    socket.setNoDelay(true);
    socket.on('connect', () => socket.write(`${JSON.stringify({
      type: 'hello', version: 1, name: `Load${String(index).padStart(2, '0')}`.slice(0, 12), session: crypto.randomBytes(16).toString('hex')
    })}\n`));
    socket.on('data', chunk => {
      peer.buffer += chunk.toString('utf8');
      let newline;
      while ((newline = peer.buffer.indexOf('\n')) >= 0) {
        const line = peer.buffer.slice(0, newline); peer.buffer = peer.buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { protocolErrors.push('invalid_json_from_server'); continue; }
        if (message.type === 'welcome') {
          clearTimeout(timeout); helloLatencies.push(performance.now() - started); resolve();
        } else if (message.type === 'snapshot') snapshots++;
        else if (message.type === 'pong') pongs++;
        else if (message.type === 'error') protocolErrors.push(message.code ?? 'unknown_error');
      }
    });
    socket.once('error', error => { clearTimeout(timeout); reject(error); });
  });

  try {
    await Promise.all(Array.from({ length: clients }, (_, index) => connectOne(index)));
    const intervalMs = Math.floor(1000 / rateHz);
    const ticker = setInterval(() => {
      for (let index = 0; index < peers.length; ++index) {
        const peer = peers[index];
        peer.seq++;
        peer.socket.write(`${JSON.stringify({ type: 'state', seq: peer.seq, map: 'load_lab', x: (index * 7 + peer.seq) % 256, y: (index * 11) % 256, facing: 'right' })}\n`);
        statesSent++;
      }
    }, intervalMs);
    ticker.unref();
    await wait(durationMs);
    clearInterval(ticker);
    for (const peer of peers) peer.socket.write(`${JSON.stringify({ type: 'ping', at: Date.now() })}\n`);
    await wait(250);
  } finally {
    for (const peer of peers) peer.socket.destroy();
  }

  const after = await health(healthUrl);
  const sorted = [...helloLatencies].sort((left, right) => left - right);
  const percentile = fraction => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
  const result = {
    ok: helloLatencies.length === clients && protocolErrors.length === 0 && pongs === clients,
    target: `${host}:${port}`,
    clients,
    durationMs,
    stateRatePerClientHz: rateHz,
    statesSent,
    snapshotsReceived: snapshots,
    pongs,
    protocolErrors,
    helloLatencyMs: { minimum: sorted[0] ?? 0, p50: percentile(0.5), p95: percentile(0.95), maximum: sorted.at(-1) ?? 0 },
    ...(before && after ? { serverDelta: { totalConnections: after.totalConnections - before.totalConnections, states: after.states - before.states, rejectedConnections: after.rejectedConnections - before.rejectedConnections, authenticationFailures: after.authenticationFailures - before.authenticationFailures } } : {})
  };
  if (!result.ok) throw new Error(`load test failed: ${JSON.stringify(result)}`);
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await runLoadTest({
    host: process.env.LOAD_HOST ?? '127.0.0.1',
    port: process.env.LOAD_PORT ?? 3210,
    clients: process.env.LOAD_CLIENTS ?? 24,
    durationMs: process.env.LOAD_DURATION_MS ?? 10000,
    rateHz: process.env.LOAD_RATE_HZ ?? 5,
    healthUrl: process.env.LOAD_HEALTH_URL ?? null,
    allowRemote: process.env.ALLOW_REMOTE_LOAD_TEST === 'YES'
  });
  console.log(JSON.stringify(result));
}
