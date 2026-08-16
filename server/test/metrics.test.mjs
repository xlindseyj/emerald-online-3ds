import assert from 'node:assert/strict';
import test from 'node:test';
import { renderPrometheusMetrics } from '../src/metrics.mjs';

test('Prometheus metrics expose bounded aggregate service state without player data', () => {
  const metrics = renderPrometheusMetrics({
    uptimeSeconds: 30, connections: 2, authenticated: 1, positioned: 1, rooms: 1,
    linkRooms: 0, linkPlayers: 0, capacity: 64, totalConnections: 3,
    rejectedConnections: 1, states: 7, chats: 2, emotes: 1
  }, { protocol: 2, databaseReady: true, memoryUsage: { rss: 1024, heapUsed: 512 } });
  assert.match(metrics, /^# HELP emerald_online_build_info/m);
  assert.match(metrics, /emerald_online_build_info\{protocol="2"\} 1/);
  assert.match(metrics, /emerald_online_database_ready 1/);
  assert.match(metrics, /emerald_online_connections 2/);
  assert.match(metrics, /emerald_online_connection_capacity 64/);
  assert.match(metrics, /# TYPE emerald_online_connections_total counter/);
  assert.match(metrics, /emerald_online_state_updates_total 7/);
  assert.match(metrics, /emerald_online_process_resident_memory_bytes 1024/);
  assert.doesNotMatch(metrics, /May|Brendan|fingerprint|remoteAddress|192\.168\./i);
});
