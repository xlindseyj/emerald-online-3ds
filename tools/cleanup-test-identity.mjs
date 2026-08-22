import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

const root = path.resolve(import.meta.dirname, '..');
const identityPath = path.resolve(process.argv[2] ?? '');
const generatedRoot = path.join(root, 'generated') + path.sep;
if (!identityPath.startsWith(generatedRoot) || path.basename(identityPath) !== 'identity.cfg') {
  throw new Error('identity path must be an identity.cfg below generated/');
}
if (!fs.existsSync(identityPath)) {
  console.log('No synthetic test identity needed cleanup.');
  process.exit(0);
}

const config = fs.readFileSync(identityPath, 'utf8');
const identity = config.match(/^id=([0-9a-f-]{36})$/m)?.[1];
const token = config.match(/^token=([0-9a-f]{64})$/m)?.[1];
if (!identity || !token) throw new Error('synthetic identity file is invalid');

await new Promise((resolve, reject) => {
  const socket = new WebSocket('wss://live.emeraldonline3ds.com/game');
  const timeout = setTimeout(() => {
    socket.terminate();
    reject(new Error('synthetic identity cleanup timed out'));
  }, 10000);
  socket.on('open', () => socket.send(`${JSON.stringify({ type: 'hello', version: 2, name: 'Azahar', identity, token, avatar: 'girl' })}\n`));
  socket.on('message', data => {
    for (const line of data.toString().split('\n').filter(Boolean)) {
      const message = JSON.parse(line);
      if (message.type === 'welcome') socket.send('{"type":"delete_identity","confirm":"DELETE"}\n');
      if (message.type === 'identity_deleted') {
        clearTimeout(timeout);
        socket.close();
        resolve();
      }
    }
  });
  socket.on('error', reject);
});

fs.unlinkSync(identityPath);
console.log('Deleted the synthetic test identity from the live service and local test profile.');
