import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const gpspSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../gpsp-runtime/source/main.cpp'), 'utf8');
const pagesSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../gpsp-runtime/source/ui/pages.cpp'), 'utf8');
const pagesHeaderSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../gpsp-runtime/source/ui/pages.h'), 'utf8');
const httpSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../gpsp-runtime/source/network/http_client.cpp'), 'utf8');
const svchaxSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../gpsp-runtime/source/ctr_svchax.c'), 'utf8');
const gpspMainSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../third_party/gpsp/main.c'), 'utf8');
const gpspRfuSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../third_party/gpsp/rfu.c'), 'utf8');

const runtimeSource = gpspSource + pagesSource + pagesHeaderSource + httpSource;

test('gpSP replacement is a dedicated direct-boot dynarec frontend', () => {
  assert.match(gpspSource, /ROM_PATH "sdmc:\/3ds\/emerald-online-3ds\/emerald\.gba"/);
  assert.match(gpspSource, /gpsp_drc.*dynarecEnabled \? "enabled" : "disabled"/s);
  assert.match(gpspSource, /svchax_init\(false\)/);
  assert.match(svchaxSource, /unsigned int __ctr_svchax = 0/);
  assert.match(svchaxSource, /svc 0x7B/);
  assert.match(svchaxSource, /k_enable_all_svcs/);
  assert.match(gpspSource, /retro_load_game\(&game\)/);
  assert.match(gpspSource, /gfxSetWide\(false\)/);
  assert.match(gpspSource, /C2D_CreateScreenTarget\(GFX_BOTTOM/);
});

test('gpSP replacement retains saves, Emerald memory reads, and online protocol', () => {
  assert.match(gpspSource, /SAVE_PATH "sdmc:\/3ds\/emerald-online-3ds\/emerald\.sav"/);
  assert.match(gpspSource, /desc->start == 0x02000000/);
  assert.match(gpspSource, /desc->start == 0x03000000/);
  assert.match(gpspSource, /gbaEwram = gpspEwram/);
  assert.match(gpspSource, /gbaIwram = gpspIwram \+ 0x8000/);
  assert.match(gpspSource, /read32\(gbaIwram, 0x5D90\)/);
  assert.match(gpspSource, /trainer-name-from-save/);
  assert.match(gpspSource, /\\"type\\":\\"hello\\"/);
  assert.match(gpspSource, /\\"type\\":\\"state\\"/);
  assert.match(gpspSource, /jsonTypeIs\(line, "snapshot"\)/);
  assert.match(gpspSource, /sendEmote/);
  assert.match(gpspSource, /openChat/);
  assert.match(gpspSource, /openBrowserPairing/);
  assert.match(gpspSource, /pair_browser_approve/);
  assert.match(gpspSource, /browser_pairing_approved/);
  assert.match(gpspSource, /TAP PROFILE TO PAIR BROWSER/);
  assert.match(gpspSource, /getaddrinfo\(serverHost/);
  assert.match(gpspSource, /serverAddressResolvedAt/);
});

test('gpSP runtime uses authenticated WebSockets for the public Cloudflare endpoint', () => {
  assert.match(gpspSource, /DEFAULT_HOST "live\.emeraldonline3ds\.com"/);
  assert.match(gpspSource, /DEFAULT_PORT 443/);
  assert.match(runtimeSource, /MBEDTLS_SSL_VERIFY_REQUIRED/);
  assert.match(gpspSource, /mbedtls_ssl_set_hostname\(&tlsContext, serverHost\)/);
  assert.match(runtimeSource, /MBEDTLS_X509_BADCERT_FUTURE/);
  assert.match(runtimeSource, /skew <= 14 \* 60 \* 60/);
  assert.match(runtimeSource, /\*flags &= ~MBEDTLS_X509_BADCERT_FUTURE/);
  assert.match(gpspSource, /NETWORK DIAGNOSTIC/);
  assert.match(gpspSource, /TLS RESULT  %d/);
  assert.match(gpspSource, /VERIFY %08lX   CLOCK \+%ds/);
  assert.match(gpspSource, /TLS HANDSHAKE/);
  assert.match(gpspSource, /LOG \/3ds\/emerald-online-3ds\/gpsp-debug\.log/);
  assert.doesNotMatch(gpspSource, /TLS%d V%08lx F%d/);
  assert.match(gpspSource, /Sec-WebSocket-Key/);
  assert.match(gpspSource, /Sec-WebSocket-Accept/);
  assert.match(gpspSource, /webSocketHeaderEquals/);
  assert.match(gpspSource, /tolower/);
  assert.doesNotMatch(gpspSource, /strstr\(response, expectedHeader\)/);
  assert.match(gpspSource, /webSocketWriteFrame/);
  assert.match(gpspSource, /parseJsonString/);
  assert.match(gpspSource, /findJsonObjectEnd/);
  assert.doesNotMatch(gpspSource, /strstr\(line, "\\\"type/);
  assert.match(gpspSource, /transport.*tcp/s);
  assert.doesNotMatch(gpspSource, /192\.168\./);
});

test('gpSP runtime centralizes HTTPS downloads in a reusable client', () => {
  assert.match(httpSource, /bool httpClientInit\(void\)/);
  assert.match(httpSource, /void httpClientShutdown\(void\)/);
  assert.match(httpSource, /bool httpDownloadFile\(const char\* url, const char\* outputPath/);
  assert.match(httpSource, /parseUrl/);
  assert.match(gpspSource, /httpDownloadFile\(url, outputPath/);
  assert.match(gpspSource, /httpDownloadFile\(url, tmpPath/);
  assert.doesNotMatch(gpspSource, /downloadHttpsFile/);
});

test('gpSP runtime uses swkbd through a shared input helper', () => {
  assert.match(gpspSource, /static bool inputText\(const char\* hint, char\* output, size_t size, unsigned maxLength\)/);
  assert.match(gpspSource, /swkbdInit\(&keyboard, SWKBD_TYPE_NORMAL, 2, maxLength\)/);
  assert.match(gpspSource, /swkbdInputText/);
  assert.match(gpspSource, /proposeCustomTeleport/);
  assert.match(gpspSource, /teleport_custom_propose/);
});

test('gpSP nonblocking connect polling initializes sockaddr for Azahar', () => {
  assert.match(gpspSource, /sockaddr_in peer = \{\};\s*peer\.sin_family = AF_INET;\s*socklen_t peerSize = sizeof\(peer\);\s*if \(!getpeername/s);
});

test('gpSP audio rate is applied after content options load', () => {
  const loadIndex = gpspSource.indexOf('retro_load_game(&game)');
  const rateIndex = gpspSource.indexOf('ndspChnSetRate(0, audioRate)');
  assert.ok(loadIndex >= 0 && rateIndex > loadIndex);
  assert.match(gpspSource, /audio-rate-32768/);
});

test('gpSP caches save-derived stats instead of rescanning Pokédex flags every frame', () => {
  assert.match(gpspSource, /nextStatsRead/);
  assert.match(gpspSource, /if \(now >= nextStatsRead\) \{ saveStats = readSaveStats\(\); nextStatsRead = now \+ 1000; \}/);
  assert.doesNotMatch(gpspSource, /recordMapTrail\(presence\);\s*saveStats = readSaveStats\(\);/);
});

test('gpSP frontend draws an animated remote trainer and emote bubble', () => {
  assert.match(gpspSource, /AVATAR_PATH/);
  assert.match(gpspSource, /C2D_SpriteSheetLoad/);
  assert.match(gpspSource, /trainerIsGirl/);
  assert.match(gpspSource, /avatar.*trainerIsGirl/s);
  assert.match(gpspSource, /drawRemoteTrainer/);
  assert.match(gpspSource, /downFrames\[4\] = \{0, 3, 0, 4\}/);
  assert.match(gpspSource, /upFrames\[4\] = \{1, 5, 1, 6\}/);
  assert.match(gpspSource, /sideFrames\[4\] = \{2, 7, 2, 8\}/);
  assert.match(gpspSource, /C2D_DrawEllipseSolid/);
  assert.match(gpspSource, /const bool step/);
  assert.match(gpspSource, /"HI", "!", "<>", "GG"/);
});

test('gpSP reports native-map coordinates but suppresses overlay trainers outside the verified overworld', () => {
  assert.match(gpspSource, /EMERALD_GMAIN_OFFSET = 0x22C0/);
  assert.match(gpspSource, /EMERALD_GMAIN_CALLBACK2_OFFSET = EMERALD_GMAIN_OFFSET \+ 0x4/);
  assert.match(gpspSource, /EMERALD_GMAIN_FLAGS_OFFSET = EMERALD_GMAIN_OFFSET \+ 0x439/);
  assert.match(gpspSource, /EMERALD_CB2_OVERWORLD_THUMB = 0x08085E5D/);
  assert.match(gpspSource, /callback2 == EMERALD_CB2_OVERWORLD_THUMB && !inBattle/);
  assert.match(gpspSource, /isEmeraldNativeMultiplayerMap/);
  assert.match(gpspSource, /mapGroup == 25.*mapNum >= 24.*mapNum <= 27.*mapNum == 60/s);
  assert.match(gpspSource, /static GamePresence readPresence[\s\S]*callback2 != EMERALD_CB2_OVERWORLD_THUMB \|\| inBattle\) return current/);
  assert.match(gpspSource, /if \(!isEmeraldOverworld\(\) \|\| !presence\.valid\) return/);
});

test('gpSP stats screen is explicit opt-in and uploads only allowlisted aggregates', () => {
  assert.match(gpspSource, /STATS_CONFIG_PATH/);
  assert.match(runtimeSource, /PLAYER STATS & CONSENT/);
  assert.match(gpspSource, /Type YES: upload Seen, Caught, Badges, Frontier/);
  assert.match(gpspSource, /Type DELETE to erase all uploaded stats/);
  assert.match(gpspSource, /stats_consent/);
  assert.match(gpspSource, /stats_snapshot/);
  assert.match(gpspSource, /pokedex_seen/);
  assert.match(gpspSource, /pokedex_caught/);
  assert.match(gpspSource, /frontier_streaks/);
  assert.match(gpspSource, /block2 \+ 0x28/);
  assert.match(gpspSource, /block2 \+ 0x5C/);
  assert.match(gpspSource, /0x1270 \+ \(flag >> 3\)/);
  assert.match(pagesSource, /PRIVATE BY DEFAULT - NO ID, PARTY, ITEMS, SAVE OR ROM/);
  const snapshotStart=gpspSource.indexOf('static bool sendStatsSnapshot');
  const snapshotEnd=gpspSource.indexOf('static void syncStatsAfterAuthentication');
  const packetSource=gpspSource.slice(snapshotStart,snapshotEnd);
  assert.doesNotMatch(packetSource,/trainerName|identityId|playerTrainerId|party|inventory|SAVE_PATH|ROM_PATH/);
});

test('gpSP bottom screen exposes local-only bag data and a same-map trainer radar', () => {
  assert.match(runtimeSource, /PAGE_BAG/);
  assert.match(runtimeSource, /PAGE_MAP/);
  assert.match(runtimeSource, /BAG - LOCAL ONLY/);
  assert.match(runtimeSource, /MAP & TRAINER RADAR/);
  assert.match(pagesSource, /EMERALD_ITEM_TABLE_OFFSET 0x5839A0/);
  assert.match(pagesSource, /read16\(block1, pocketOffset \+ slot \* 4 \+ 2\) \^ \(uint16_t\) encryptionKey/);
  assert.match(pagesSource, /read32\(block1, 0x490\) \^ encryptionKey/);
  assert.match(runtimeSource, /loadPrivateItemNames\(\)/);
  assert.match(runtimeSource, /recordMapTrail\(presence\)/);
  assert.match(pagesSource, /remoteTrainers\[index\]\.x - presence\.x/);
  assert.match(pagesSource, /LOCAL RADAR/);
  const bagStart = pagesSource.indexOf('void drawBagPage');
  const bagEnd = pagesSource.indexOf('void recordMapTrail', bagStart);
  const bagSource = pagesSource.slice(bagStart, bagEnd);
  assert.doesNotMatch(bagSource, /onlineSend|stats_snapshot|fetch|send\(/);
});

test('gpSP bottom screen exposes paged users plus readable map and global chat lists', () => {
  assert.match(runtimeSource, /PAGE_USERS/);
  assert.match(runtimeSource, /PAGE_CHAT/);
  assert.match(runtimeSource, /ONLINE USERS - READ ONLY/);
  assert.match(pagesSource, /GLOBAL MAP \/ TILE POSITIONS - %u ONLINE/);
  assert.match(gpspSource, /jsonTypeIs\(line, "online_users"\)/);
  assert.match(gpspSource, /OnlineUser onlineUsers\[64\]/);
  assert.match(runtimeSource, /char role\[10\]/);
  assert.match(gpspSource, /jsonStringBounded\(user, objectEnd, "role", candidate\.role/);
  assert.match(pagesSource, /TRAINER/);
  assert.match(pagesSource, /TYPE/);
  assert.match(pagesSource, /MAP\/TILE/);
  assert.match(runtimeSource, /roleLabel/);
  assert.match(runtimeSource, /roleColor/);
  assert.match(pagesSource, /pageCount = onlineUserCount \? \(onlineUserCount \+ 5\) \/ 6 : 1/);
  assert.match(pagesSource, /MAP CHAT/);
  assert.match(pagesSource, /GLOBAL CHAT/);
  assert.match(gpspSource, /scope.*global/s);
  assert.match(pagesSource, /SESSION ONLY - (?:UTC|TIMES ARE UTC)/);
  assert.match(gpspSource, /ChatMessage chatHistory\[24\]/);
  assert.match(pagesSource, /message->name/);
  assert.match(pagesSource, /message->time/);
  assert.match(pagesSource, /message->text/);
  assert.match(runtimeSource, /currentChatIndices/);
  assert.match(runtimeSource, /drawChatDetail/);
  assert.match(pagesSource, /TAP TO READ/);
  assert.match(pagesSource, /chatPage \* 3/);
  assert.match(pagesSource, /COMPOSE/);
  assert.match(gpspSource, /bottomPage \+ 1\) % 9/);
  assert.match(gpspSource, /!strcmp\(equals, "users"\) \? PAGE_USERS/);
  assert.match(gpspSource, /!strcmp\(equals, "chat"\) \? PAGE_CHAT/);
  assert.match(gpspSource, /!strcmp\(equals, "teleport"\) \? PAGE_TELEPORT/);
  assert.match(gpspSource, /drawConnectionDot/);
  assert.match(gpspSource, /ONLINE_ACTIVE/);
  assert.match(gpspSource, /drawPageIndicators/);
  const usersStart = pagesSource.indexOf('void drawOnlineUsersPage');
  const usersEnd = pagesSource.indexOf('static unsigned currentChatIndices', usersStart);
  assert.doesNotMatch(pagesSource.slice(usersStart, usersEnd), /openChat|sendEmote|onlineSend/);
});

test('gpSP teleport page is server-verified and writes GBA location fields', () => {
  assert.match(runtimeSource, /PAGE_TELEPORT/);
  assert.match(pagesSource, /"TELEPORT"/);
  assert.match(runtimeSource, /drawTeleportPage/);
  assert.match(gpspSource, /TeleportDestination teleportDestinations\[64\]/);
  assert.match(gpspSource, /teleportCustomVisible/);
  assert.match(gpspSource, /jsonTypeIs\(line, "teleport_locations"\)/);
  assert.match(gpspSource, /jsonTypeIs\(line, "teleport_result"\)/);
  assert.match(gpspSource, /\\"type\\":\\"teleport\\",\\"destination_id\\":\\"%s\\"/);
  assert.match(gpspSource, /\\"type\\":\\"teleport_locations\\"/);
  assert.match(gpspSource, /applyTeleport/);
  assert.match(gpspSource, /gbaEwram\[offset \+ 4\] = mapGroup/);
  assert.match(gpspSource, /gbaEwram\[offset \+ 5\] = mapNum/);
});

test('gpSP update page detects, downloads, verifies, and installs releases', () => {
  assert.match(runtimeSource, /PAGE_UPDATE/);
  assert.match(runtimeSource, /"SYSTEM UPDATE"/);
  assert.match(runtimeSource, /drawUpdatePage/);
  assert.match(gpspSource, /checkForUpdate/);
  assert.match(gpspSource, /startUpdateDownload/);
  assert.match(gpspSource, /installUpdate/);
  assert.match(httpSource, /httpDownloadFile/);
  assert.match(gpspSource, /sha256File/);
  assert.match(gpspSource, /installCia/);
  assert.match(gpspSource, /replace3dsx/);
  assert.match(gpspSource, /\/api\/release/);
  assert.match(gpspSource, /UPDATE_DIRECTORY/);
  assert.match(gpspSource, /% 9/);
});

test('gpSP Emerald link mode uses RFU and gates startup on rotating save backups', () => {
  assert.match(gpspSource, /gpsp_serial.*linkConfigured \? "rfu" : "disabled"/s);
  assert.doesNotMatch(gpspSource, /gpsp_serial.*linkConfigured \? "mul_poke"/s);
  assert.match(gpspSource, /RETRO_ENVIRONMENT_SET_NETPACKET_INTERFACE/);
  assert.match(gpspSource, /frontendNetpacketSend/);
  assert.match(gpspSource, /link_spike_join/);
  assert.match(gpspSource, /link_packet/);
  assert.match(gpspSource, /size > 512/);
  assert.match(gpspSource, /backupSaveForLink\(\)/);
  assert.match(gpspSource, /LINK_BACKUP_DIRECTORY/);
  assert.match(gpspSource, /fflush\(destination\).*fsync\(fileno\(destination\)\)/s);
  assert.match(gpspSource, /index \+ 3 < count/);
  const start = gpspSource.indexOf('if (jsonTypeIs(line, "link_started"))');
  const callback = gpspSource.indexOf('coreNetpacketInterface->start((uint16_t)', start);
  const backup = gpspSource.indexOf('backupSaveForLink()', start);
  assert.ok(start >= 0 && backup > start && callback > backup, 'save backup must complete before the core netpacket session starts');
  assert.match(gpspSource, /LINK %s ACTIVE - BACKUP OK/);
});

test('gpSP services RFU packets inside wait callbacks and requests New 3DS speedup', () => {
  assert.match(gpspSource, /frontendNetpacketPollReceive[\s\S]*linkStarted[\s\S]*receiveOnlineTraffic\(\)/);
  assert.match(gpspSource, /nextOnlinePoll = now \+ \(linkStarted \? 1 : 100\)/);
  assert.match(gpspSource, /osSetSpeedupEnable\(true\)/);
});

test('gpSP RFU preserves transient scans while clearing genuine peer withdrawals', () => {
  assert.match(gpspRfuSource, /NET_RFU_BROADCAST_STOP/);
  const hostStop = gpspRfuSource.indexOf('case RFU_CMD_HOST_STOP:');
  const hostAccept = gpspRfuSource.indexOf('case RFU_CMD_HOST_ACCEPT:', hostStop);
  assert.ok(hostStop >= 0 && hostAccept > hostStop, 'host stop command must be present');
  assert.doesNotMatch(
    gpspRfuSource.slice(hostStop, hostAccept),
    /NET_RFU_BROADCAST_STOP/,
    'Emerald cycles host stop while scanning, so it must not withdraw the active advertisement'
  );
  const receiveStop = gpspRfuSource.indexOf('case NET_RFU_BROADCAST_STOP:');
  const clearPeer = gpspRfuSource.indexOf('memset(&rfu_peer_bcst[client_id]', receiveStop);
  assert.ok(receiveStop >= 0 && clearPeer > receiveStop, 'room withdrawal must clear the matching peer advertisement');
  assert.match(gpspRfuSource, /case NET_RFU_DISCONNECT:[\s\S]*rfu_peer_bcst\[client_id\]\.device_id == \(hdata & 0xffff\)[\s\S]*memset\(&rfu_peer_bcst\[client_id\]/);
});

test('gpSP does not touch unmapped 3DS translation caches in interpreter mode', () => {
  assert.match(gpspMainSource, /if \(dynarec_enable\)\s*\{\s*init_dynarec_caches\(\);\s*init_emitter\(gamepak_must_swap\(\)\);\s*\}/s);
});
