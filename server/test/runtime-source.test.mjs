import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const gpspSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../gpsp-runtime/source/main.cpp'), 'utf8');
const pagesSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../gpsp-runtime/source/ui/pages.cpp'), 'utf8');
const pagesHeaderSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../gpsp-runtime/source/ui/pages.h'), 'utf8');
const localizationHeaderSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../gpsp-runtime/source/ui/localization.h'), 'utf8');
const localizationSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../gpsp-runtime/source/ui/localization.cpp'), 'utf8');
const logHeaderSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../gpsp-runtime/source/runtime/log.h'), 'utf8');
const logSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../gpsp-runtime/source/runtime/log.cpp'), 'utf8');
const httpSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../gpsp-runtime/source/network/http_client.cpp'), 'utf8');
const svchaxSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../gpsp-runtime/source/ctr_svchax.c'), 'utf8');
const gpspMainSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../third_party/gpsp/main.c'), 'utf8');
const gpspRfuSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../third_party/gpsp/rfu.c'), 'utf8');
const copyTo3dsScript = fs.readFileSync(path.resolve(import.meta.dirname, '../../scripts/copy-to-3ds.sh'), 'utf8');

const runtimeSource = gpspSource + pagesSource + pagesHeaderSource + httpSource + localizationHeaderSource + localizationSource + logHeaderSource + logSource;

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
  assert.match(gpspSource, /localize\(LS_TAP_PROFILE_PAIR_BROWSER\)/);
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
  assert.match(runtimeSource, /NETWORK DIAGNOSTIC/);
  assert.match(runtimeSource, /TLS RESULT  %d/);
  assert.match(runtimeSource, /VERIFY %08lX   CLOCK \+%ds/);
  assert.match(gpspSource, /TLS HANDSHAKE/);
  assert.match(runtimeSource, /LOG \/3ds\/emerald-online-3ds\/gpsp-debug\.log/);
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

test('gpSP input handling uses hidKeysRepeat and debounces touch', () => {
  assert.match(gpspSource, /repeatKeys = hidKeysDownRepeat\(\)/);
  assert.match(gpspSource, /TOUCH_DEBOUNCE_MS 150/);
  assert.match(gpspSource, /touchDebounceUntil/);
  assert.match(gpspSource, /\(down & KEY_TOUCH\) && now >= touchDebounceUntil/);
  assert.match(gpspSource, /handleRepeatInput/);
  assert.match(gpspSource, /KEY_LEFT \| KEY_CPAD_LEFT/);
  assert.match(gpspSource, /KEY_RIGHT \| KEY_CPAD_RIGHT/);
  assert.match(gpspSource, /KEY_UP \| KEY_CPAD_UP/);
  assert.match(gpspSource, /KEY_DOWN \| KEY_CPAD_DOWN/);
});

test('gpSP caches static labels and exposes a larger static text cache', () => {
  assert.match(pagesSource, /STATIC_TEXT_CACHE_SIZE 256/);
  assert.match(pagesSource, /STATIC_TEXT_BUFFER_SIZE 8192/);
  assert.match(runtimeSource, /void drawTextStatic\(/);
  assert.match(runtimeSource, /drawTextStatic\(/);
  assert.match(pagesSource, /void drawWaitingMessage/);
  assert.match(pagesSource, /void drawEmptyMessage/);
  assert.match(pagesSource, /void drawConnectOnlineMessage/);
  assert.match(pagesSource, /drawMessageCentered\(110\.0f/);
});

test('gpSP exposes a Settings page and persisted display preferences', () => {
  assert.match(pagesHeaderSource, /PAGE_SETTINGS/);
  assert.match(gpspSource, /DISPLAY_CONFIG_PATH/);
  assert.match(gpspSource, /loadDisplayConfig/);
  assert.match(gpspSource, /saveDisplayConfig/);
  assert.match(pagesSource, /void drawSettingsPage/);
  assert.match(gpspSource, /hudVisible/);
  assert.match(gpspSource, /fpsVisible/);
  assert.match(gpspSource, /trailLength/);
  assert.match(gpspSource, /labelFadeDistance/);
  assert.match(gpspSource, /bottomPage == PAGE_SETTINGS/);
});

test('gpSP supports accessibility mode and top-screen toast notifications', () => {
  assert.match(pagesHeaderSource, /bool accessibilityMode/);
  assert.match(pagesSource, /float uiScale\(/);
  assert.match(pagesSource, /uint32_t uiTextColor\(/);
  assert.match(pagesSource, /uint32_t uiPanelColor\(/);
  assert.match(gpspSource, /accessibilityMode = !accessibilityMode/);
  assert.match(gpspSource, /accessibility_mode/);
  assert.match(pagesSource, /Toast toastQueue\[2\]/);
  assert.match(pagesSource, /void showToast\(/);
  assert.match(pagesSource, /void drawToasts\(/);
  assert.match(gpspSource, /drawToasts\(\)/);
  assert.match(localizationSource, /LS_ACCESSIBILITY_MODE/);
  assert.match(localizationSource, /LS_TOAST_NEW_MESSAGE/);
  assert.match(localizationSource, /LS_TOAST_QUEST_ACCEPTED/);
  assert.match(localizationSource, /LS_TOAST_QUEST_COMPLETED/);
  assert.match(localizationSource, /LS_TOAST_FRIEND_ONLINE/);
  assert.match(localizationSource, /LS_TOAST_GUILD_UPDATED/);
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
  assert.match(gpspSource, /localize\(LS_HI\), localize\(LS_EXCLAMATION\), localize\(LS_ANGLED_BRACKETS\), localize\(LS_GG\)/);
  // Interpolation, depth sorting, and title rendering.
  assert.match(gpspSource, /REMOTE_INTERPOLATION_MS/);
  assert.match(gpspSource, /smoothstepf/);
  assert.match(gpspSource, /visible\[.*\]\.screenY.*visible\[.*\]\.screenY/s);
  assert.match(gpspSource, /withAlpha\(/);
  assert.match(gpspSource, /t->title\[0\]/);
  assert.match(pagesHeaderSource, /int16_t prevX;/);
  assert.match(pagesHeaderSource, /int16_t prevY;/);
  assert.match(pagesHeaderSource, /uint64_t updatedAt;/);
  assert.match(pagesHeaderSource, /char title\[33\];/);
  assert.match(pagesHeaderSource, /MapTrailPoint trail\[8\];/);
  assert.match(pagesHeaderSource, /unsigned trailCount;/);
  assert.match(pagesHeaderSource, /unsigned trailNext;/);
  assert.match(gpspSource, /C2D_DrawLine/);
  assert.match(gpspSource, /labelAlpha/);
  assert.match(gpspSource, /clampf\(v\.screenX, 12\.0f, 400\.0f - spriteW - 12\.0f\)/);
  assert.match(gpspSource, /clampf\(v\.screenY, labelH, 240\.0f - spriteH\)/);
  // Top-screen HUD shows FPS, connection status, and nearby count.
  assert.match(gpspSource, /localize\(LS_FPS_FORMAT\)/);
  assert.match(gpspSource, /localize\(LS_NEARBY_FORMAT\)/);
  assert.match(gpspSource, /localize\(LS_ONLINE\)/);
  assert.match(gpspSource, /localize\(LS_CONNECTING\)/);
  assert.match(gpspSource, /localize\(LS_RETRYING\)/);
  assert.match(gpspSource, /localize\(LS_OFFLINE\)/);
  // Interactive quest log.
  assert.match(pagesHeaderSource, /struct QuestRequirement/);
  assert.match(pagesHeaderSource, /uint8_t requirementCount;/);
  assert.match(pagesHeaderSource, /char reward_kind\[16\];/);
  assert.match(pagesSource, /questDetailOpen/);
  assert.match(pagesSource, /LS_QUEST_STAGES/);
  assert.match(gpspSource, /sendQuestClaim/);
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
  assert.match(runtimeSource, /localize\(LS_PLAYER_STATS_AND_CONSENT\)/);
  assert.match(runtimeSource, /Type YES: upload Seen, Caught, Badges, Frontier/);
  assert.match(runtimeSource, /Type DELETE to erase all uploaded stats/);
  assert.match(gpspSource, /stats_consent/);
  assert.match(gpspSource, /stats_snapshot/);
  assert.match(gpspSource, /pokedex_seen/);
  assert.match(gpspSource, /pokedex_caught/);
  assert.match(gpspSource, /frontier_streaks/);
  assert.match(gpspSource, /block2 \+ 0x28/);
  assert.match(gpspSource, /block2 \+ 0x5C/);
  assert.match(gpspSource, /0x1270 \+ \(flag >> 3\)/);
  assert.match(pagesSource, /localize\(LS_PRIVATE_BY_DEFAULT\)/);
  const snapshotStart=gpspSource.indexOf('static bool sendStatsSnapshot');
  const snapshotEnd=gpspSource.indexOf('static void syncStatsAfterAuthentication');
  const packetSource=gpspSource.slice(snapshotStart,snapshotEnd);
  assert.doesNotMatch(packetSource,/trainerName|identityId|playerTrainerId|party|inventory|SAVE_PATH|ROM_PATH/);
});

test('gpSP bottom screen exposes local-only bag data and a same-map trainer radar', () => {
  assert.match(runtimeSource, /PAGE_BAG/);
  assert.match(runtimeSource, /PAGE_MAP/);
  assert.match(runtimeSource, /localize\(LS_BAG_LOCAL_ONLY\)/);
  assert.match(runtimeSource, /localize\(LS_MAP_TRAINER_RADAR\)/);
  assert.match(pagesSource, /EMERALD_ITEM_TABLE_OFFSET 0x5839A0/);
  assert.match(pagesSource, /read16\(block1, pocketOffset \+ slot \* 4 \+ 2\) \^ \(uint16_t\) encryptionKey/);
  assert.match(pagesSource, /read32\(block1, 0x490\) \^ encryptionKey/);
  assert.match(runtimeSource, /loadPrivateItemNames\(\)/);
  assert.match(runtimeSource, /recordMapTrail\(presence\)/);
  assert.match(pagesSource, /remoteTrainers\[index\]\.x - presence\.x/);
  assert.match(pagesSource, /localize\(LS_LOCAL_RADAR\)/);
  const bagStart = pagesSource.indexOf('void drawBagPage');
  const bagEnd = pagesSource.indexOf('void recordMapTrail', bagStart);
  const bagSource = pagesSource.slice(bagStart, bagEnd);
  assert.doesNotMatch(bagSource, /onlineSend|stats_snapshot|fetch|send\(/);
});

test('gpSP bottom screen exposes paged users plus readable map and global chat lists', () => {
  assert.match(runtimeSource, /PAGE_USERS/);
  assert.match(runtimeSource, /PAGE_CHAT/);
  assert.match(runtimeSource, /localize\(LS_ONLINE_USERS_READ_ONLY\)/);
  assert.match(pagesSource, /localize\(LS_GLOBAL_MAP_TILE_POSITIONS_FORMAT\)/);
  assert.match(gpspSource, /jsonTypeIs\(line, "online_users"\)/);
  assert.match(gpspSource, /OnlineUser onlineUsers\[64\]/);
  assert.match(runtimeSource, /char role\[10\]/);
  assert.match(gpspSource, /jsonStringBounded\(user, objectEnd, "role", candidate\.role/);
  assert.match(pagesSource, /localize\(LS_TRAINER\)/);
  assert.match(pagesSource, /localize\(LS_TYPE\)/);
  assert.match(pagesSource, /localize\(LS_MAP_TILE\)/);
  assert.match(runtimeSource, /roleLabel/);
  assert.match(runtimeSource, /roleColor/);
  assert.match(pagesSource, /pageCount = onlineUserCount \? \(onlineUserCount \+ 5\) \/ 6 : 1/);
  assert.match(pagesSource, /localize\(LS_MAP_CHAT\)/);
  assert.match(pagesSource, /localize\(LS_GLOBAL_CHAT\)/);
  assert.match(gpspSource, /scope.*global/s);
  assert.match(runtimeSource, /SESSION ONLY - (?:UTC|TIMES ARE UTC)/);
  assert.match(gpspSource, /ChatMessage chatHistory\[24\]/);
  assert.match(pagesSource, /message->name/);
  assert.match(pagesSource, /message->time/);
  assert.match(pagesSource, /message->text/);
  assert.match(runtimeSource, /currentChatIndices/);
  assert.match(runtimeSource, /drawChatDetail/);
  assert.match(runtimeSource, /TAP TO READ/);
  assert.match(pagesSource, /chatPage \* 3/);
  assert.match(pagesSource, /localize\(LS_COMPOSE\)/);
  assert.match(gpspSource, /bottomPage \+ 1\) % PAGE_COUNT/);
  assert.match(gpspSource, /KEY_L/);
  assert.match(gpspSource, /KEY_R/);
  assert.match(gpspSource, /bottomPage \+ PAGE_COUNT - 1\) % PAGE_COUNT/);
  assert.match(gpspSource, /!strcmp\(equals, "users"\) \? PAGE_USERS/);
  assert.match(gpspSource, /!strcmp\(equals, "chat"\) \? PAGE_CHAT/);
  assert.match(gpspSource, /!strcmp\(equals, "titles"\) \? PAGE_TITLES/);
  assert.match(gpspSource, /!strcmp\(equals, "friends"\) \? PAGE_FRIENDS/);
  assert.match(gpspSource, /!strcmp\(equals, "guild"\) \? PAGE_GUILD/);
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
  assert.match(pagesSource, /localize\(LS_TELEPORT_BUTTON\)/);
  assert.match(runtimeSource, /drawTeleportPage/);
  assert.match(gpspSource, /TeleportDestination teleportDestinations\[64\]/);
  assert.match(gpspSource, /teleportCustomVisible/);
  assert.match(gpspSource, /jsonTypeIs\(line, "teleport_locations"\)/);
  assert.match(gpspSource, /jsonTypeIs\(line, "teleport_result"\)/);
  assert.match(gpspSource, /\\"type\\":\\"teleport\\",\\"destination_id\\":\\"%s\\"/);
  assert.match(gpspSource, /\\"type\\":\\"teleport_locations\\"/);
  assert.match(gpspSource, /applyTeleport/);
  assert.match(gpspSource, /EMERALD_CB2_DO_CHANGE_MAP_THUMB = 0x08134B45/);
  assert.match(gpspSource, /EMERALD_CB2_LOAD_MAP2_THUMB = 0x080860C9/);
  const teleportStart = gpspSource.indexOf('static void applyTeleport');
  const teleportEnd = gpspSource.indexOf('static bool parseVersion', teleportStart);
  const teleportSource = gpspSource.slice(teleportStart, teleportEnd);
  assert.match(teleportSource, /if \(!isEmeraldOverworld\(\)\) return;/);
  assert.match(teleportSource, /gbaEwram\[offset \+ 4\] = mapGroup/);
  assert.match(teleportSource, /gbaEwram\[offset \+ 5\] = mapNum/);
  assert.match(teleportSource, /gbaEwram\[offset \+ 0x06\] = 0xFF/);
  assert.match(teleportSource, /gbaEwram\[offset \+ 0x08\]/);
  assert.match(teleportSource, /gbaEwram\[offset \+ 0x0A\]/);
  assert.match(teleportSource, /gbaIwram\[EMERALD_GMAIN_STATE_OFFSET\] = 0/);
  assert.match(teleportSource, /write32\(gbaIwram, EMERALD_GMAIN_SAVED_CALLBACK_OFFSET, EMERALD_CB2_LOAD_MAP2_THUMB\)/);
  assert.match(teleportSource, /write32\(gbaIwram, EMERALD_GMAIN_CALLBACK2_OFFSET, EMERALD_CB2_DO_CHANGE_MAP_THUMB\)/);
});

test('gpSP update page detects, downloads, verifies, and installs releases', () => {
  assert.match(runtimeSource, /PAGE_UPDATE/);
  assert.match(runtimeSource, /localize\(LS_SYSTEM_UPDATE\)/);
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
  assert.match(gpspSource, /% PAGE_COUNT/);
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
  assert.match(gpspSource, /LINK_BACKUP_RETENTION/);
  assert.match(gpspSource, /fflush\(destination\).*fsync\(fileno\(destination\)\)/s);
  assert.match(gpspSource, /index \+ LINK_BACKUP_RETENTION < count/);
  assert.match(gpspSource, /verifyEmeraldSaveFile\(SAVE_PATH\)/);
  assert.match(gpspSource, /verifyEmeraldSaveFile\(path\)/);
  assert.match(gpspSource, /restoreSaveFromBackup/);
  const start = gpspSource.indexOf('if (jsonTypeIs(line, "link_started"))');
  const callback = gpspSource.indexOf('coreNetpacketInterface->start((uint16_t)', start);
  const backup = gpspSource.indexOf('backupSaveForLink()', start);
  assert.ok(start >= 0 && backup > start && callback > backup, 'save backup must complete before the core netpacket session starts');
  assert.match(gpspSource, /localize\(LS_LINK_ACTIVE_BACKUP_OK_FORMAT\)/);
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

test('gpSP RFU treats SEND_DATAW as a non-blocking send to avoid Union Room battle timeouts', () => {
  const datawCase = gpspRfuSource.indexOf('case RFU_CMD_SEND_DATAW:');
  const waitCase = gpspRfuSource.indexOf('case RFU_CMD_WAIT:');
  const rtxCase = gpspRfuSource.indexOf('case RFU_CMD_RTX_WAIT:');
  assert.ok(datawCase >= 0, 'RFU_CMD_SEND_DATAW handler must exist');
  assert.ok(waitCase > datawCase, 'RFU_CMD_WAIT must be defined after SEND_DATAW');
  assert.ok(rtxCase > datawCase, 'RFU_CMD_RTX_WAIT must be defined after SEND_DATAW');
  assert.match(gpspRfuSource, /SEND_DATAW is intentionally excluded/);
  assert.match(gpspRfuSource, /case RFU_CMD_SEND_DATAW:\s*case RFU_CMD_SEND_DATA:/s);
  // The blocking branch that flips the RFU into master/wait mode must include
  // WAIT and RTX_WAIT, but not SEND_DATAW.
  const blockingCondition = gpspRfuSource.match(/if \(rfu_cmd == RFU_CMD_WAIT \|\| rfu_cmd == RFU_CMD_RTX_WAIT\)/);
  assert.ok(blockingCondition, 'blocking condition must match only WAIT and RTX_WAIT');
  assert.doesNotMatch(gpspRfuSource, /rfu_cmd == RFU_CMD_SEND_DATAW/);
});

test('physical 3DS transfer script copies release CIA and 3DSX to standard SD paths', () => {
  assert.match(copyTo3dsScript, /Usage: \$0 <3ds-ip> \[ftp-port\]/);
  assert.match(copyTo3dsScript, /release\/emerald-online-3ds\.cia/);
  assert.match(copyTo3dsScript, /release\/emerald-online-3ds\.3dsx/);
  assert.match(copyTo3dsScript, /\/cias\/emerald-online-3ds\.cia/);
  assert.match(copyTo3dsScript, /\/3ds\/emerald-online-3ds\/emerald-online-3ds\.3dsx/);
  assert.match(copyTo3dsScript, /curl -T/);
  assert.doesNotMatch(copyTo3dsScript, /192\.168\./);
});

test('gpSP does not touch unmapped 3DS translation caches in interpreter mode', () => {
  assert.match(gpspMainSource, /if \(dynarec_enable\)\s*\{\s*init_dynarec_caches\(\);\s*init_emitter\(gamepak_must_swap\(\)\);\s*\}/s);
});

test('runtime Phase 3 upgrades: APT hooks, cached text, and decoupled audio thread', () => {
  assert.match(gpspSource, /aptHook\(&aptCookie, aptHookCallback, NULL\)/);
  assert.match(gpspSource, /APTHOOK_ONSLEEP/);
  assert.match(gpspSource, /APTHOOK_ONWAKEUP/);
  assert.match(gpspSource, /APTHOOK_ONEXIT/);
  assert.match(gpspSource, /systemAsleep/);
  assert.match(gpspSource, /ndspSetMasterVol/);
  assert.match(gpspSource, /if \(systemAsleep\) \{/);
  assert.match(gpspSource, /aptUnhook\(&aptCookie\)/);

  assert.match(pagesSource, /initStaticTextCache/);
  assert.match(pagesSource, /shutdownStaticTextCache/);
  assert.match(pagesSource, /staticTextBuffer/);
  assert.match(pagesSource, /StaticTextEntry/);

  assert.match(gpspSource, /audioThreadMain/);
  assert.match(gpspSource, /audioRing/);
  assert.match(gpspSource, /LightEvent/);
  assert.match(gpspSource, /LightLock/);
  assert.match(gpspSource, /threadCreate\(audioThreadMain/);
  assert.match(gpspSource, /threadJoin\(audioThread, U64_MAX\)/);
  assert.match(gpspSource, /threadFree\(audioThread\)/);
  assert.match(gpspSource, /audioThreadMain[\s\S]*?ndspChnWaveBufAdd/);

  const audioBatchStart = gpspSource.indexOf('static size_t audioBatchCallback');
  const audioBatchEnd = gpspSource.indexOf('\nstatic void inputPollCallback', audioBatchStart);
  assert.ok(audioBatchStart >= 0 && audioBatchEnd > audioBatchStart);
  assert.doesNotMatch(gpspSource.slice(audioBatchStart, audioBatchEnd), /ndspChnWaveBufAdd/);
});

test('runtime Phase 4 upgrades: localization support', () => {
  assert.match(localizationHeaderSource, /enum LocalizedString/);
  assert.match(localizationHeaderSource, /bool localizationInit\(void\)/);
  assert.match(localizationHeaderSource, /void localizationShutdown\(void\)/);
  assert.match(localizationHeaderSource, /const char\* localize\(LocalizedString key\)/);
  assert.match(runtimeSource, /localize\(/);
  assert.match(pagesSource, /localize\(/);
  assert.match(localizationSource, /cfguInit\(\)/);
  assert.match(localizationSource, /CFGU_GetSystemLanguage/);
});

test('runtime Phase 4 upgrades: runtime observability', () => {
  assert.match(logHeaderSource, /runtimeLogInit/);
  assert.match(logHeaderSource, /runtimeLogShutdown/);
  assert.match(logHeaderSource, /runtimeLogPrintf/);
  assert.match(logHeaderSource, /runtimeLogGetRecent/);
  assert.match(logHeaderSource, /runtimeLogUploadRecent/);
  assert.match(logSource, /LogEntry ringBuffer/);
  assert.match(logSource, /RUNTIME_LOG_RING_ENTRIES/);
  assert.match(logSource, /osGetTime\(\)/);
  assert.match(logSource, /\\"type\\":\\"telemetry\\",\\"lines\\":\[/);
  assert.match(gpspSource, /runtimeLogInit\(\)/);
  assert.match(gpspSource, /runtimeLogShutdown\(\)/);
  assert.match(gpspSource, /runtimeLogPrintf/);
  assert.match(gpspSource, /gpsp-debug\.log/);
  assert.match(gpspSource, /runtimeLogUploadRecent/);
  assert.match(gpspSource, /debugStage[\s\S]*?runtimeLogPrintf/s);
});

test('runtime renders online NPCs and a quest log on the bottom screen', () => {
  assert.match(pagesHeaderSource, /PAGE_QUESTS/);
  assert.match(pagesSource, /void drawQuestPage\(void\)/);
  assert.match(pagesSource, /void drawNpcDialogueOverlay\(void\)/);
  assert.match(runtimeSource, /OnlineNpc onlineNpcs\[8\]/);
  assert.match(runtimeSource, /QuestLogEntry questLog\[8\]/);
  assert.match(runtimeSource, /NpcDialogue npcDialogue/);
  assert.match(gpspSource, /jsonTypeIs\(line, "npc_snapshot"\)/);
  assert.match(gpspSource, /jsonTypeIs\(line, "npc_dialogue"\)/);
  assert.match(gpspSource, /jsonTypeIs\(line, "quest_update"\)/);
  assert.match(gpspSource, /jsonTypeIs\(line, "quest_list"\)/);
  assert.match(gpspSource, /sendNpcInteract\(/);
  assert.match(gpspSource, /sendQuestAccept\(/);
  assert.match(gpspSource, /requestQuestList\(/);
  assert.match(gpspSource, /drawNpcDialogueOverlay\(\)/);
});

test('runtime Phase 2 upgrades: titles and friends pages', () => {
  assert.match(pagesHeaderSource, /PAGE_TITLES/);
  assert.match(pagesHeaderSource, /PAGE_FRIENDS/);
  assert.match(pagesSource, /void drawTitlesPage\(void\)/);
  assert.match(pagesSource, /void drawFriendsPage\(void\)/);
  assert.match(runtimeSource, /TitleEntry playerTitles\[16\]/);
  assert.match(runtimeSource, /FriendEntry playerFriends\[32\]/);
  assert.match(gpspSource, /jsonTypeIs\(line, "title_list"\)/);
  assert.match(gpspSource, /jsonTypeIs\(line, "title_equipped"\)/);
  assert.match(gpspSource, /jsonTypeIs\(line, "friend_list"\)/);
  assert.match(gpspSource, /jsonTypeIs\(line, "friend_result"\)/);
  assert.match(gpspSource, /jsonTypeIs\(line, "friend_removed"\)/);
  assert.match(gpspSource, /sendTitleEquip\(/);
  assert.match(gpspSource, /sendFriendRequest\(/);
  assert.match(gpspSource, /sendFriendAccept\(/);
  assert.match(gpspSource, /sendFriendRemove\(/);
  assert.match(gpspSource, /requestFriendList\(/);
  assert.match(gpspSource, /drawTitlesPage\(\)/);
  assert.match(gpspSource, /drawFriendsPage\(\)/);
  assert.match(localizationSource, /LS_TITLE_LOG/);
  assert.match(localizationSource, /LS_FRIENDS_LIST/);
});

test('runtime Phase 3 upgrades: guild page and protocol', () => {
  assert.match(pagesHeaderSource, /PAGE_GUILD/);
  assert.match(pagesSource, /void drawGuildPage\(void\)/);
  assert.match(runtimeSource, /GuildInfo guildInfo/);
  assert.match(runtimeSource, /GuildMember guildMembers\[50\]/);
  assert.match(gpspSource, /jsonTypeIs\(line, "guild_info"\)/);
  assert.match(gpspSource, /jsonTypeIs\(line, "guild_update"\)/);
  assert.match(gpspSource, /sendGuildCreate\(/);
  assert.match(gpspSource, /sendGuildJoin\(/);
  assert.match(gpspSource, /sendGuildLeave\(/);
  assert.match(gpspSource, /sendGuildDisband\(/);
  assert.match(gpspSource, /sendGuildKick\(/);
  assert.match(gpspSource, /requestGuildInfo\(/);
  assert.match(gpspSource, /drawGuildPage\(\)/);
  assert.match(localizationSource, /LS_GUILD/);
  assert.match(localizationSource, /LS_NO_GUILD/);
});
