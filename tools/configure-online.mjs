import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const configPath = process.env.ONLINE_CONFIG_PATH ?? path.join(root, 'generated', 'sd-card', '3ds', 'emerald-online-3ds', 'online.cfg');
const server = process.env.GAME_PUBLIC_HOST ?? 'live.emeraldonline3ds.com';
const port = Number(process.env.GAME_PUBLIC_PORT ?? 443);
const transport = process.env.GAME_TRANSPORT ?? 'wss';
const webSocketPath = process.env.GAME_WEBSOCKET_PATH ?? '/game';
const linkRoom = process.env.LINK_ROOM;

if (!/^(?:[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?|(?:\d{1,3}\.){3}\d{1,3})$/.test(server)) throw new Error('invalid GAME_PUBLIC_HOST');
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('invalid GAME_PUBLIC_PORT');
if (!['wss', 'tcp'].includes(transport)) throw new Error('GAME_TRANSPORT must be wss or tcp');
if (!/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]{0,126}$/.test(webSocketPath)) throw new Error('invalid GAME_WEBSOCKET_PATH');
if (linkRoom !== undefined && !/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/.test(linkRoom)) throw new Error('LINK_ROOM must use XXXX-XXXX without 0, 1, I, or O');

let current = '';
try { current = fs.readFileSync(configPath, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const values = new Map();
for (const line of current.split(/\r?\n/)) {
  const separator = line.indexOf('=');
  if (separator > 0) values.set(line.slice(0, separator), line.slice(separator + 1));
}
values.set('server', server);
values.set('port', String(port));
values.set('transport', transport);
values.set('path', webSocketPath);
if (linkRoom !== undefined) values.set('link_room', linkRoom);
if (!values.has('name')) values.set('name', 'Trainer');
// v2 stores its server-issued credential in identity.cfg, never online.cfg.
values.delete('session');
const preferredOrder = ['server', 'port', 'transport', 'path', 'name', 'page', 'dynarec', 'link_room'];
const lines = [];
for (const key of preferredOrder) if (values.has(key)) lines.push(`${key}=${values.get(key)}`);
for (const [key, value] of values) if (!preferredOrder.includes(key)) lines.push(`${key}=${value}`);
fs.mkdirSync(path.dirname(configPath), { recursive: true });
const temporary = `${configPath}.${process.pid}.tmp`;
fs.writeFileSync(temporary, `${lines.join('\n')}\n`, { mode: 0o600 });
fs.renameSync(temporary, configPath);
console.log(`Configured ${configPath} for ${transport}://${server}:${port}${transport === 'wss' ? webSocketPath : ''}`);
