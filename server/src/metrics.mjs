const GAUGES = [
  ['uptimeSeconds', 'emerald_online_uptime_seconds', 'Seconds since the presence process started.'],
  ['connections', 'emerald_online_connections', 'Current open presence connections.'],
  ['authenticated', 'emerald_online_authenticated_players', 'Current authenticated players.'],
  ['positioned', 'emerald_online_positioned_players', 'Current players with an overworld position.'],
  ['rooms', 'emerald_online_map_rooms', 'Current occupied map rooms.'],
  ['linkRooms', 'emerald_online_link_rooms', 'Current experimental link rooms.'],
  ['linkPlayers', 'emerald_online_link_players', 'Current players in experimental link rooms.'],
  ['capacity', 'emerald_online_connection_capacity', 'Configured maximum presence connections.']
];

const COUNTERS = [
  ['totalConnections', 'emerald_online_connections_total', 'Accepted and rejected TCP connections since process start.'],
  ['rejectedConnections', 'emerald_online_connections_rejected_total', 'Connections rejected because the server was full.'],
  ['ipRejectedConnections', 'emerald_online_ip_connections_rejected_total', 'Connections rejected by the per-IP limit.'],
  ['helloTimeouts', 'emerald_online_hello_timeouts_total', 'Connections closed before authentication completed.'],
  ['enrollments', 'emerald_online_enrollments_total', 'Device identity enrollments completed.'],
  ['recoveries', 'emerald_online_recoveries_total', 'Device identity recoveries completed.'],
  ['authenticationFailures', 'emerald_online_authentication_failures_total', 'Failed authentication or recovery attempts.'],
  ['hellos', 'emerald_online_authenticated_sessions_total', 'Successful legacy or authenticated protocol sessions.'],
  ['states', 'emerald_online_state_updates_total', 'Accepted overworld state updates.'],
  ['chats', 'emerald_online_chat_messages_total', 'Accepted same-map chat messages.'],
  ['emotes', 'emerald_online_emotes_total', 'Accepted same-map emotes.'],
  ['statsConsents', 'emerald_online_stats_consent_updates_total', 'Accepted statistics consent updates.'],
  ['statsSnapshots', 'emerald_online_stats_snapshots_total', 'Accepted statistics snapshots.'],
  ['linkJoins', 'emerald_online_link_joins_total', 'Accepted experimental link-room joins.'],
  ['linkPackets', 'emerald_online_link_packets_total', 'Experimental link packets relayed.'],
  ['linkLeaves', 'emerald_online_link_leaves_total', 'Experimental link-room leaves.'],
  ['linkRateLimited', 'emerald_online_link_rate_limited_total', 'Experimental link packets rejected by rate limits.'],
  ['reconnectReplacements', 'emerald_online_reconnect_replacements_total', 'Older sessions replaced by a reconnect.'],
  ['disconnects', 'emerald_online_disconnects_total', 'Presence connections closed.']
];

function sample(name, type, help, value) {
  const number = Number(value);
  const safe = Number.isFinite(number) && number >= 0 ? number : 0;
  return `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${safe}\n`;
}

export function renderPrometheusMetrics(status, { protocol = 2, databaseReady = false, memoryUsage = process.memoryUsage() } = {}) {
  let output = '# HELP emerald_online_build_info Static service build information.\n# TYPE emerald_online_build_info gauge\n';
  output += `emerald_online_build_info{protocol="${Number(protocol)}"} 1\n`;
  output += sample('emerald_online_database_ready', 'gauge', 'Whether the application database is ready.', databaseReady ? 1 : 0);
  output += sample('emerald_online_process_resident_memory_bytes', 'gauge', 'Resident memory used by the presence process.', memoryUsage.rss);
  output += sample('emerald_online_process_heap_used_bytes', 'gauge', 'JavaScript heap bytes used by the presence process.', memoryUsage.heapUsed);
  for (const [key, name, help] of GAUGES) output += sample(name, 'gauge', help, status[key]);
  for (const [key, name, help] of COUNTERS) output += sample(name, 'counter', help, status[key]);
  return output;
}
