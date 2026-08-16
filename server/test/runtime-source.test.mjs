import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const gpspSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../gpsp-runtime/source/main.cpp'), 'utf8');
const svchaxSource = fs.readFileSync(path.resolve(import.meta.dirname, '../../gpsp-runtime/source/ctr_svchax.c'), 'utf8');

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
  assert.match(gpspSource, /getaddrinfo\(serverHost/);
  assert.match(gpspSource, /serverAddressResolvedAt/);
});

test('gpSP runtime uses authenticated WebSockets for the public Cloudflare endpoint', () => {
  assert.match(gpspSource, /DEFAULT_HOST "live\.emeraldonline3ds\.com"/);
  assert.match(gpspSource, /DEFAULT_PORT 443/);
  assert.match(gpspSource, /MBEDTLS_SSL_VERIFY_REQUIRED/);
  assert.match(gpspSource, /mbedtls_ssl_set_hostname\(&tlsContext, serverHost\)/);
  assert.match(gpspSource, /MBEDTLS_X509_BADCERT_FUTURE/);
  assert.match(gpspSource, /skew <= 14 \* 60 \* 60/);
  assert.match(gpspSource, /\*flags &= ~MBEDTLS_X509_BADCERT_FUTURE/);
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

test('gpSP audio rate is applied after content options load', () => {
  const loadIndex = gpspSource.indexOf('retro_load_game(&game)');
  const rateIndex = gpspSource.indexOf('ndspChnSetRate(0, audioRate)');
  assert.ok(loadIndex >= 0 && rateIndex > loadIndex);
  assert.match(gpspSource, /audio-rate-32768/);
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
