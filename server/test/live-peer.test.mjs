import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..', '..');
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

test('spawned live peer follows only player-proven tiles', async t => {
  const initial = { map: 'route', x: 5, y: 5, facing: 'right', avatar: 'boy' };
  const observations = [
    { ...initial, x: 6 },
    { ...initial, x: 7 },
    { ...initial, x: 7, y: 6, facing: 'down' },
    { ...initial, x: 11, y: 9 }, // skipped updates: exact rebase, no inferred path
    { ...initial, x: 11, y: 10, facing: 'down' }
  ];
  const allowed = new Set([initial, ...observations].map(state => `${state.map}:${state.x}:${state.y}`));
  const published = [];

  const health = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ clients: [{ name: 'LINZ', state: initial }] }));
  });
  await listen(health);
  t.after(() => health.close());

  let scheduled = false;
  const game = net.createServer(socket => {
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk;
      for (let newline; (newline = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        const message = JSON.parse(line);
        if (message.type !== 'state') continue;
        published.push(message);
        if (scheduled) continue;
        scheduled = true;
        const delays = [40, 100, 160, 600, 680];
        observations.forEach((state, index) => setTimeout(() => {
          if (!socket.destroyed) socket.write(`${JSON.stringify({ type: 'snapshot', map: state.map, players: [{ id: 'physical', name: 'LINZ', ...state }] })}\n`);
        }, delays[index]));
      }
    });
  });
  await listen(game);
  t.after(() => game.close());

  const child = spawn(process.execPath, ['tools/live-peer.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      GAME_HOST: '127.0.0.1',
      GAME_PORT: String(game.address().port),
      HEALTH_PORT: String(health.address().port),
      PEER_DURATION_MS: '1100',
      PEER_STEP_MS: '250',
      PEER_NAME: 'SafePeer'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exitCode = await new Promise(resolve => child.once('exit', resolve));
  assert.equal(exitCode, 0, stderr);
  assert.ok(published.length >= 3, `expected movement states, got ${published.length}`);
  assert.ok(published.every(state => allowed.has(`${state.map}:${state.x}:${state.y}`)), JSON.stringify(published));
  assert.equal(published.some(state => state.x === 11 && state.y === 9), true, 'skipped update rebases on the observed tile');
  assert.equal(published.some(state => state.x === 6 && state.y === 5), true, 'peer follows a proven breadcrumb');
});

test('spawned live peer validates an optional target map', async () => {
  const child = spawn(process.execPath, ['tools/live-peer.mjs'], {
    cwd: root,
    env: { ...process.env, PEER_TARGET_MAP: '../unsafe' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  const exitCode = await new Promise(resolve => child.once('exit', resolve));
  assert.notEqual(exitCode, 0);
  assert.match(stderr, /PEER_TARGET_MAP must be a safe map identifier/);
});
