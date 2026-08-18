#include "pages.h"

#define ROM_PATH "sdmc:/3ds/emerald-online-3ds/emerald.gba"
#define EMERALD_ITEM_TABLE_OFFSET 0x5839A0
#define EMERALD_ITEM_COUNT 377
#define EMERALD_ITEM_RECORD_SIZE 44
#define STATIC_TEXT_CACHE_SIZE 128
#define STATIC_TEXT_BUFFER_SIZE 4096

// Pre-baked static UI labels. Citro2D text objects are parsed once at first use
// and reused from a dedicated buffer so per-frame menus do not re-parse the
// same labels every render pass.
struct StaticTextEntry {
    char text[80];
    float size;
    uint32_t color;
    C2D_Text textObj;
};

static C2D_TextBuf staticTextBuffer;
static StaticTextEntry staticTextCache[STATIC_TEXT_CACHE_SIZE];
static unsigned staticTextCacheCount = 0;

bool initStaticTextCache(void) {
    staticTextBuffer = C2D_TextBufNew(STATIC_TEXT_BUFFER_SIZE);
    return staticTextBuffer != NULL;
}

void shutdownStaticTextCache(void) {
    if (staticTextBuffer) { C2D_TextBufDelete(staticTextBuffer); staticTextBuffer = NULL; }
    staticTextCacheCount = 0;
}

static const C2D_Text* findStaticText(const char* text, float size, uint32_t color) {
    for (unsigned i = 0; i < staticTextCacheCount; ++i) {
        if (staticTextCache[i].size == size && staticTextCache[i].color == color && !strcmp(staticTextCache[i].text, text))
            return &staticTextCache[i].textObj;
    }
    return NULL;
}

static const C2D_Text* addStaticText(const char* text, float size, uint32_t color) {
    if (staticTextCacheCount >= STATIC_TEXT_CACHE_SIZE) return NULL;
    StaticTextEntry* entry = &staticTextCache[staticTextCacheCount++];
    strncpy(entry->text, text, sizeof(entry->text) - 1);
    entry->text[sizeof(entry->text) - 1] = 0;
    entry->size = size;
    entry->color = color;
    if (uiFont) C2D_TextFontParse(&entry->textObj, uiFont, staticTextBuffer, entry->text);
    else C2D_TextParse(&entry->textObj, staticTextBuffer, entry->text);
    C2D_TextOptimize(&entry->textObj);
    return &entry->textObj;
}

static uint16_t read16(const uint8_t* memory, size_t offset) {
    uint16_t value;
    memcpy(&value, memory + offset, sizeof(value));
    return value;
}

static uint32_t read32(const uint8_t* memory, size_t offset) {
    uint32_t value;
    memcpy(&value, memory + offset, sizeof(value));
    return value;
}

void drawText(float x, float y, float size, uint32_t color, const char* format, ...) {
    char line[192];
    va_list args;
    va_start(args, format);
    vsnprintf(line, sizeof(line), format, args);
    va_end(args);
    const C2D_Text* cached = findStaticText(line, size, color);
    if (!cached && staticTextBuffer) cached = addStaticText(line, size, color);
    if (cached) {
        C2D_DrawText(cached, C2D_WithColor, x, y, 0.5f, size, size, color);
        return;
    }
    C2D_Text text;
    if (uiFont) C2D_TextFontParse(&text, uiFont, textBuffer, line);
    else C2D_TextParse(&text, textBuffer, line);
    C2D_TextOptimize(&text);
    C2D_DrawText(&text, C2D_WithColor, x, y, 0.5f, size, size, color);
}

char decodeEmerald(uint8_t value) {
    if (value >= 0xA1 && value <= 0xAA) return '0' + value - 0xA1;
    if (value >= 0xBB && value <= 0xD4) return 'A' + value - 0xBB;
    if (value >= 0xD5 && value <= 0xEE) return 'a' + value - 0xD5;
    if (value == 0x00) return ' ';
    if (value == 0x1B) return 'e';
    if (value == 0x2D) return '&';
    if (value == 0x2E) return '+';
    if (value == 0xAB) return '!';
    if (value == 0xAC) return '?';
    if (value == 0xAD) return '.';
    if (value == 0xAE) return '-';
    if (value == 0xB4) return '\'';
    if (value == 0xB8) return ',';
    if (value == 0xBA) return '/';
    return '?';
}

void loadPrivateItemNames(void) {
    FILE* file = fopen(ROM_PATH, "rb");
    if (!file || fseek(file, EMERALD_ITEM_TABLE_OFFSET, SEEK_SET)) { if (file) fclose(file); return; }
    uint8_t record[EMERALD_ITEM_RECORD_SIZE];
    for (unsigned item = 0; item < EMERALD_ITEM_COUNT; ++item) {
        if (fread(record, 1, sizeof(record), file) != sizeof(record)) break;
        unsigned output = 0;
        for (unsigned input = 0; input < 14 && record[input] != 0xFF && output < sizeof(itemNames[item]) - 1; ++input) {
            char decoded = decodeEmerald(record[input]);
            itemNames[item][output++] = decoded;
        }
        while (output && itemNames[item][output - 1] == ' ') --output;
        itemNames[item][output] = 0;
    }
    fclose(file);
    itemNamesLoaded = itemNames[1][0] != 0;
}

bool getSaveBlocks(const uint8_t** block1, const uint8_t** block2) {
    if (!gbaEwram || !gbaIwram) return false;
    uint32_t block1Address = read32(gbaIwram, 0x5D8C);
    uint32_t block2Address = read32(gbaIwram, 0x5D90);
    if (block1Address < 0x02000000 || block1Address + 0x3D88 > 0x02040000 ||
        block2Address < 0x02000000 || block2Address + 0xF2C > 0x02040000) return false;
    *block1 = gbaEwram + block1Address - 0x02000000;
    *block2 = gbaEwram + block2Address - 0x02000000;
    return true;
}

const char* facingName(uint8_t facing) {
    if (facing == 2) return "up";
    if (facing == 3) return "left";
    if (facing == 4) return "right";
    return "down";
}

static void recordMapTrailInternal(const GamePresence& current) {
    if (!current.valid) return;
    if (mapTrailCount) {
        const unsigned last = (mapTrailNext + 15) % 16;
        if (mapTrail[last].mapGroup != current.mapGroup || mapTrail[last].mapNum != current.mapNum) {
            mapTrailCount = mapTrailNext = 0;
        } else if (mapTrail[last].x == current.x && mapTrail[last].y == current.y) return;
    }
    mapTrail[mapTrailNext] = {current.mapGroup, current.mapNum, current.x, current.y};
    mapTrailNext = (mapTrailNext + 1) % 16;
    if (mapTrailCount < 16) ++mapTrailCount;
}

void recordMapTrail(const GamePresence& current) {
    recordMapTrailInternal(current);
}

uint32_t roleColor(const char* role) {
    if (!strcmp(role, "admin")) return C2D_Color32(218, 165, 32, 255);
    if (!strcmp(role, "moderator")) return C2D_Color32(34, 160, 120, 255);
    return C2D_Color32(80, 95, 90, 255);
}

const char* roleLabel(const char* role) {
    if (!strcmp(role, "admin")) return "ADMIN";
    if (!strcmp(role, "moderator")) return "MOD";
    return "PLAYER";
}

void drawBagPage(void) {
    static const char* pocketNames[] = {"ITEMS", "KEY", "BALLS", "TM/HM", "BERRY"};
    static const size_t pocketOffsets[] = {0x560, 0x5D8, 0x650, 0x690, 0x790};
    static const unsigned pocketCapacities[] = {30, 30, 16, 64, 46};
    for (unsigned pocket = 0; pocket < 5; ++pocket) {
        const float x = pocket * 64.0f;
        C2D_DrawRectSolid(x + 1, 42, 0, 62, 25, pocket == bagPocket ? C2D_Color32(34,126,82,255) : C2D_Color32(43,61,55,255));
        drawText(x + 9, 49, .31f, C2D_Color32(255,255,255,255), "%s", pocketNames[pocket]);
    }
    const uint8_t* block1;
    const uint8_t* block2;
    if (!getSaveBlocks(&block1, &block2)) {
        drawText(34, 116, .42f, C2D_Color32(190,210,200,255), "Waiting for valid Emerald memory...");
        return;
    }
    uint32_t encryptionKey = read32(block2, 0xAC);
    uint32_t money = read32(block1, 0x490) ^ encryptionKey;
    const size_t pocketOffset = pocketOffsets[bagPocket];
    const unsigned capacity = pocketCapacities[bagPocket];
    unsigned used = 0;
    for (unsigned slot = 0; slot < capacity; ++slot) {
        uint16_t itemId = read16(block1, pocketOffset + slot * 4);
        if (itemId > 0 && itemId < EMERALD_ITEM_COUNT) ++used;
    }
    const unsigned pageCount = used ? (used + 4) / 5 : 1;
    if (bagPage >= pageCount) bagPage = pageCount - 1;
    drawText(15, 74, .32f, C2D_Color32(255,213,128,255), "LOCAL ONLY   MONEY $%lu", (unsigned long) money);
    drawText(244, 74, .30f, C2D_Color32(190,220,210,255), "%u/%u", bagPage + 1, pageCount);
    const unsigned first = bagPage * 5;
    unsigned logicalIndex = 0;
    unsigned shown = 0;
    for (unsigned slot = 0; slot < capacity && shown < 5; ++slot) {
        uint16_t itemId = read16(block1, pocketOffset + slot * 4);
        if (!itemId || itemId >= EMERALD_ITEM_COUNT) continue;
        if (logicalIndex++ < first) continue;
        uint16_t quantity = read16(block1, pocketOffset + slot * 4 + 2) ^ (uint16_t) encryptionKey;
        const float y = 92 + shown * 24;
        C2D_DrawRectSolid(10, y, 0, 300, 21, C2D_Color32(shown & 1 ? 22 : 25, shown & 1 ? 61 : 74, shown & 1 ? 46 : 54, 255));
        const char* name = itemNamesLoaded && itemNames[itemId][0] ? itemNames[itemId] : "UNKNOWN ITEM";
        drawText(18, y + 4, .38f, C2D_Color32(255,255,255,255), "%.14s", name);
        drawText(256, y + 4, .36f, C2D_Color32(190,225,210,255), "x%u", quantity);
        ++shown;
    }
    if (!shown) drawText(112, 140, .40f, C2D_Color32(180,205,200,255), "Pocket is empty");
    C2D_DrawRectSolid(10, 216, 0, 145, 24, bagPage ? C2D_Color32(45,105,76,255) : C2D_Color32(45,55,51,255));
    C2D_DrawRectSolid(165, 216, 0, 145, 24, bagPage + 1 < pageCount ? C2D_Color32(45,105,76,255) : C2D_Color32(45,55,51,255));
    drawText(64, 221, .35f, C2D_Color32(255,255,255,255), "PREVIOUS");
    drawText(226, 221, .35f, C2D_Color32(255,255,255,255), "NEXT");
}

void drawMapPage(void) {
    if (!presence.valid) {
        drawText(38, 110, .45f, C2D_Color32(190,210,200,255), "Waiting for the Emerald overworld...");
        return;
    }
    const float radarX = 12, radarY = 45, radarWidth = 200, radarHeight = 180;
    const float centerX = radarX + radarWidth / 2, centerY = radarY + radarHeight / 2;
    C2D_DrawRectSolid(radarX, radarY, 0, radarWidth, radarHeight, C2D_Color32(16,55,41,255));
    for (int x = -8; x <= 8; x += 2) C2D_DrawRectSolid(centerX + x * 10, radarY, 0, 1, radarHeight, C2D_Color32(31,76,59,255));
    for (int y = -8; y <= 8; y += 2) C2D_DrawRectSolid(radarX, centerY + y * 10, 0, radarWidth, 1, C2D_Color32(31,76,59,255));
    for (unsigned trail = 0; trail < mapTrailCount; ++trail) {
        const unsigned index = (mapTrailNext + 16 - mapTrailCount + trail) % 16;
        int dx = mapTrail[index].x - presence.x, dy = mapTrail[index].y - presence.y;
        if (dx >= -9 && dx <= 9 && dy >= -8 && dy <= 8)
            C2D_DrawRectSolid(centerX + dx * 10 - 2, centerY + dy * 10 - 2, .05f, 5, 5, C2D_Color32(83,154,107,180));
    }
    C2D_DrawRectSolid(centerX - 6, centerY - 6, .2f, 13, 13, C2D_Color32(255,213,90,255));
    drawText(centerX - 3, centerY - 7, .31f, C2D_Color32(20,45,35,255), "P");
    for (int index = 0; index < remoteCount; ++index) {
        int dx = remoteTrainers[index].x - presence.x, dy = remoteTrainers[index].y - presence.y;
        int shownX = dx < -9 ? -9 : dx > 9 ? 9 : dx;
        int shownY = dy < -8 ? -8 : dy > 8 ? 8 : dy;
        const uint32_t color = remoteTrainers[index].isGirl ? C2D_Color32(232,111,170,255) : C2D_Color32(80,164,245,255);
        C2D_DrawRectSolid(centerX + shownX * 10 - 5, centerY + shownY * 10 - 5, .2f, 11, 11, color);
    }
    drawText(224, 48, .34f, C2D_Color32(160,232,255,255), "LOCAL RADAR");
    drawText(224, 69, .31f, C2D_Color32(255,255,255,255), "MAP %u-%u", presence.mapGroup, presence.mapNum);
    drawText(224, 87, .31f, C2D_Color32(255,255,255,255), "TILE %d,%d", presence.x, presence.y);
    drawText(224, 105, .31f, C2D_Color32(190,220,210,255), "FACING %s", facingName(presence.facing));
    drawText(224, 130, .33f, C2D_Color32(160,232,255,255), "NEARBY %d", remoteCount);
    for (int index = 0; index < remoteCount && index < 4; ++index) {
        int distance = abs(remoteTrainers[index].x - presence.x) + abs(remoteTrainers[index].y - presence.y);
        drawText(224, 150 + index * 18, .29f, C2D_Color32(255,255,255,255), "%.8s %dt", remoteTrainers[index].name, distance);
    }
    if (!remoteCount) drawText(228, 153, .29f, C2D_Color32(180,205,200,255), "No trainers");
}

void drawStatsPage(void) {
    drawText(12,42,.30f,C2D_Color32(255,213,128,255),"PRIVATE BY DEFAULT - NO ID, PARTY, ITEMS, SAVE OR ROM");
    if (!saveStats.valid) drawText(40,61,.37f,C2D_Color32(190,210,200,255),"Waiting for valid Emerald memory...");
    else drawText(18,61,.36f,C2D_Color32(220,245,235,255),"LOCAL: SEEN %u  CAUGHT %u  BADGES %u/8",saveStats.seen,saveStats.caught,saveStats.badges);
    const char* labels[4]={"POKEDEX SEEN","POKEDEX CAUGHT","BADGE COUNT","FRONTIER STREAKS"};
    const bool values[4]={statsSeenEnabled,statsCaughtEnabled,statsBadgesEnabled,statsFrontierEnabled};
    for(unsigned index=0;index<4;++index){
        float y=82+index*28;
        C2D_DrawRectSolid(12,y,0,296,23,values[index]?C2D_Color32(31,104,66,255):C2D_Color32(50,58,57,255));
        drawText(20,y+5,.36f,C2D_Color32(255,255,255,255),"%s",labels[index]);
        drawText(260,y+5,.34f,values[index]?C2D_Color32(130,255,176,255):C2D_Color32(180,190,185,255),"%s",values[index]?"ON":"OFF");
    }
    if(statsStatus[0] && (!statsStatusUntil || osGetTime()<statsStatusUntil)) drawText(15,196,.29f,C2D_Color32(255,220,130,255),"%.46s",statsStatus);
    if(!statsEnabled){
        C2D_DrawRectSolid(12,212,0,296,28,C2D_Color32(35,145,88,255));
        drawText(68,219,.38f,C2D_Color32(255,255,255,255),"ENABLE UPLOAD - EXPLICIT CONSENT");
    }else{
        C2D_DrawRectSolid(12,212,0,143,28,C2D_Color32(35,126,91,255));
        C2D_DrawRectSolid(165,212,0,143,28,C2D_Color32(145,55,55,255));
        drawText(48,219,.38f,C2D_Color32(255,255,255,255),"SYNC NOW");
        drawText(187,219,.34f,C2D_Color32(255,255,255,255),"DELETE ALL STATS");
    }
}

void drawOnlineUsersPage(void) {
    drawText(14, 43, .30f, C2D_Color32(255,213,128,255), "GLOBAL MAP / TILE POSITIONS - %u ONLINE", onlineUserCount);
    drawText(14, 61, .33f, C2D_Color32(160,232,255,255), "TRAINER");
    drawText(150, 61, .33f, C2D_Color32(160,232,255,255), "TYPE");
    drawText(218, 61, .33f, C2D_Color32(160,232,255,255), "MAP/TILE");
    const unsigned pageCount = onlineUserCount ? (onlineUserCount + 5) / 6 : 1;
    if (onlineUserPage >= pageCount) onlineUserPage = pageCount - 1;
    const unsigned start = onlineUserPage * 6;
    for (unsigned row = 0; row < 6; ++row) {
        const float y = 78 + row * 22;
        C2D_DrawRectSolid(10, y, 0, 300, 19, C2D_Color32(row & 1 ? 22 : 25, row & 1 ? 61 : 74, row & 1 ? 46 : 54, 255));
        const unsigned index = start + row;
        if (index >= onlineUserCount) continue;
        const OnlineUser* user = &onlineUsers[index];
        drawText(14, y + 3, .35f, C2D_Color32(255,255,255,255), "%.12s", user->name);
        const uint32_t typeColor = roleColor(user->role);
        C2D_DrawRectSolid(144, y + 2, .05f, 62, 15, typeColor);
        const char* label = roleLabel(user->role);
        float labelWidth = strlen(label) * 6.0f; // approximate for .28f font
        drawText(175 - labelWidth / 2, y + 3, .28f, C2D_Color32(255,255,255,255), "%s", label);
        if (user->positioned)
            drawText(214, y + 3, .30f, C2D_Color32(190,225,210,255), "%.10s %d,%d", user->map, user->x, user->y);
        else drawText(236, y + 3, .29f, C2D_Color32(180,205,200,255), "WAITING");
    }
    if (!onlineUserCount)
        drawText(71, 126, .40f, C2D_Color32(180,205,200,255), onlineMode == ONLINE_ACTIVE ? "Waiting for the online roster..." : "Connect online to view users");
    C2D_DrawRectSolid(10, 216, 0, 145, 24, onlineUserPage ? C2D_Color32(45,105,76,255) : C2D_Color32(45,55,51,255));
    C2D_DrawRectSolid(165, 216, 0, 145, 24, onlineUserPage + 1 < pageCount ? C2D_Color32(45,105,76,255) : C2D_Color32(45,55,51,255));
    drawText(42, 221, .34f, C2D_Color32(255,255,255,255), "PREVIOUS");
    drawText(212, 221, .34f, C2D_Color32(255,255,255,255), "NEXT");
}

unsigned currentChatIndices(unsigned indices[24]) {
    if (!globalChat && !presence.valid) return 0;
    char map[33];
    snprintf(map, sizeof(map), "%u-%u", presence.mapGroup, presence.mapNum);
    unsigned count = 0;
    for (unsigned index = 0; index < chatHistoryCount; ++index)
        if (globalChat ? chatHistory[index].global : (!chatHistory[index].global && !strcmp(chatHistory[index].map, map)))
            indices[count++] = index;
    return count;
}

static void drawChatDetail(const ChatMessage* message) {
    drawText(16, 74, .42f, C2D_Color32(160,232,255,255), "%.12s", message->name);
    drawText(238, 76, .33f, C2D_Color32(190,220,210,255), "%s", message->time);
    drawText(16, 96, .31f, C2D_Color32(255,213,128,255), "%s FROM MAP %.16s", message->global ? "GLOBAL" : "MAP", message->map);
    const char* at = message->text;
    for (unsigned row = 0; row < 3 && *at; ++row) {
        size_t remaining = strlen(at), length = remaining > 34 ? 34 : remaining;
        if (remaining > length) {
            size_t split = length;
            while (split > 20 && at[split] != ' ') --split;
            if (split > 20) length = split;
        }
        char line[35] = {};
        memcpy(line, at, length);
        drawText(16, 123 + row * 25, .42f, C2D_Color32(255,255,255,255), "%s", line);
        at += length;
        while (*at == ' ') ++at;
    }
    C2D_DrawRectSolid(10, 216, 0, 300, 24, C2D_Color32(45,105,76,255));
    drawText(126, 221, .34f, C2D_Color32(255,255,255,255), "BACK");
}

void drawChatPage(void) {
    unsigned indices[24];
    const unsigned count = currentChatIndices(indices);
    const unsigned pageCount = count ? (count + 2) / 3 : 1;
    if (chatPage >= pageCount) chatPage = pageCount - 1;
    C2D_DrawRectSolid(10, 42, 0, 145, 24, globalChat ? C2D_Color32(45,55,51,255) : C2D_Color32(35,145,88,255));
    C2D_DrawRectSolid(165, 42, 0, 145, 24, globalChat ? C2D_Color32(35,145,88,255) : C2D_Color32(45,55,51,255));
    drawText(58, 47, .35f, C2D_Color32(255,255,255,255), "MAP CHAT");
    drawText(204, 47, .35f, C2D_Color32(255,255,255,255), "GLOBAL CHAT");
    if (chatDetailIndex >= 0 && (unsigned) chatDetailIndex < chatHistoryCount) {
        drawChatDetail(&chatHistory[chatDetailIndex]);
        return;
    }
    if (globalChat)
        drawText(14, 70, .30f, C2D_Color32(255,213,128,255), "%u GLOBAL MSG - SESSION ONLY - UTC - TAP TO READ", count);
    else if (presence.valid)
        drawText(14, 70, .30f, C2D_Color32(255,213,128,255), "%u MSG - MAP %u-%u - UTC - TAP TO READ", count, presence.mapGroup, presence.mapNum);
    else drawText(14, 70, .30f, C2D_Color32(255,213,128,255), "CURRENT MAP - SESSION ONLY - TIMES ARE UTC");
    const unsigned start = chatPage * 3;
    for (unsigned row = 0; row < 3; ++row) {
        const float y = 86 + row * 40;
        C2D_DrawRectSolid(10, y, 0, 300, 36, C2D_Color32(row & 1 ? 22 : 25, row & 1 ? 61 : 74, row & 1 ? 46 : 54, 255));
        const unsigned visible = start + row;
        if (visible >= count) continue;
        const ChatMessage* message = &chatHistory[indices[visible]];
        drawText(18, y + 3, .38f, C2D_Color32(160,232,255,255), "%.12s", message->name);
        drawText(263, y + 4, .32f, C2D_Color32(190,220,210,255), "%s", message->time);
        drawText(18, y + 20, .34f, C2D_Color32(255,255,255,255), "%.38s", message->text);
    }
    if (!count)
        drawText(64, 132, .39f, C2D_Color32(180,205,200,255), globalChat ? "No global messages this session" : presence.valid ? "No messages on this map yet" : "Waiting for the overworld...");
    C2D_DrawRectSolid(10, 216, 0, 94, 24, chatPage ? C2D_Color32(45,105,76,255) : C2D_Color32(45,55,51,255));
    C2D_DrawRectSolid(113, 216, 0, 94, 24, onlineMode == ONLINE_ACTIVE && presence.valid ? C2D_Color32(35,145,88,255) : C2D_Color32(45,55,51,255));
    C2D_DrawRectSolid(216, 216, 0, 94, 24, chatPage + 1 < pageCount ? C2D_Color32(45,105,76,255) : C2D_Color32(45,55,51,255));
    drawText(26, 221, .32f, C2D_Color32(255,255,255,255), "PREVIOUS");
    drawText(131, 221, .34f, C2D_Color32(255,255,255,255), "COMPOSE");
    drawText(244, 221, .34f, C2D_Color32(255,255,255,255), "NEXT");
}

bool teleportKindMatches(const char* kind) {
    if (teleportCategory == 0) return true;
    if (teleportCategory == 1) return !strcmp(kind, "gym");
    if (teleportCategory == 2) return !strcmp(kind, "location");
    if (teleportCategory == 3) return !strcmp(kind, "player");
    if (teleportCategory == 4) return !strcmp(kind, "mom");
    if (teleportCategory == 5) return !strcmp(kind, "custom");
    return false;
}

void drawTeleportPage(void) {
    const char* categories[] = {"ALL", "GYMS", "LOCS", "PLAYERS", "MOM", "CUSTOM"};
    const unsigned categoryCount = teleportCustomVisible ? 6 : 5;
    const float tabWidth = 300.0f / categoryCount;
    for (unsigned i = 0; i < categoryCount; ++i) {
        float x = 10 + i * tabWidth;
        C2D_DrawRectSolid(x + 1, 42, 0, tabWidth - 2, 22, i == teleportCategory ? C2D_Color32(34,126,82,255) : C2D_Color32(43,61,55,255));
        drawText(x + 5, 47, .24f, C2D_Color32(255,255,255,255), "%s", categories[i]);
    }
    if (!teleportDestinationCount) {
        drawText(70, 110, .42f, C2D_Color32(190,210,200,255), onlineMode == ONLINE_ACTIVE ? "Waiting for destinations..." : "Connect online to teleport");
        return;
    }
    unsigned filtered[64];
    unsigned filteredCount = 0;
    for (unsigned i = 0; i < teleportDestinationCount; ++i)
        if (teleportKindMatches(teleportDestinations[i].kind)) filtered[filteredCount++] = i;
    const unsigned maxRows = 7;
    if (teleportScroll + maxRows > filteredCount && filteredCount > maxRows) teleportScroll = filteredCount - maxRows;
    if (teleportScroll >= filteredCount) teleportScroll = 0;
    for (unsigned row = 0; row < maxRows; ++row) {
        const float y = 70 + row * 20;
        const unsigned visible = teleportScroll + row;
        bool selected = visible < filteredCount && (int)filtered[visible] == teleportSelectedIndex;
        C2D_DrawRectSolid(10, y, 0, 300, 18, selected ? C2D_Color32(34,126,82,255) : C2D_Color32(row & 1 ? 22 : 25, row & 1 ? 61 : 74, row & 1 ? 46 : 54, 255));
        if (visible >= filteredCount) continue;
        const TeleportDestination* dest = &teleportDestinations[filtered[visible]];
        drawText(14, y + 3, .32f, C2D_Color32(255,255,255,255), "%.26s", dest->name);
        drawText(250, y + 3, .28f, C2D_Color32(190,220,210,255), "%.8s", dest->kind);
    }
    const bool canAddCustom = teleportCategory == 5 && (!strcmp(trainerRole, "admin") || !strcmp(trainerRole, "moderator"));
    if (teleportSelectedIndex >= 0 && (unsigned)teleportSelectedIndex < teleportDestinationCount) {
        C2D_DrawRectSolid(10, 216, 0, 300, 24, C2D_Color32(35,145,88,255));
        drawText(110, 221, .34f, C2D_Color32(255,255,255,255), "TELEPORT");
    } else {
        bool showAddCustom = canAddCustom && teleportScroll == 0;
        C2D_DrawRectSolid(10, 216, 0, 145, 24, showAddCustom || teleportScroll ? C2D_Color32(45,105,76,255) : C2D_Color32(45,55,51,255));
        C2D_DrawRectSolid(165, 216, 0, 145, 24, teleportScroll + maxRows < filteredCount ? C2D_Color32(45,105,76,255) : C2D_Color32(45,55,51,255));
        drawText(showAddCustom ? 30 : 42, 221, .34f, C2D_Color32(255,255,255,255), showAddCustom ? "ADD CUSTOM" : "PREVIOUS");
        drawText(212, 221, .34f, C2D_Color32(255,255,255,255), "NEXT");
    }
    if (teleportStatus[0] && (!teleportStatusUntil || osGetTime() < teleportStatusUntil))
        drawText(15, 64, .29f, C2D_Color32(255,220,130,255), "%.46s", teleportStatus);
}

void drawUpdatePage(void) {
    drawText(14, 43, .30f, C2D_Color32(255,213,128,255), "CURRENT VERSION: %s", APP_VERSION);
    if (updateLatestVersion[0] && updateState != UPDATE_IDLE && updateState != UPDATE_CHECKING) {
        drawText(14, 62, .30f, C2D_Color32(160,232,255,255), "LATEST: %s", updateLatestVersion);
    }

    if (updateState == UPDATE_DOWNLOADING || updateState == UPDATE_VERIFYING) {
        float pct = updateTotal > 0 ? (float) updateProgress / (float) updateTotal : 0.0f;
        if (pct > 1.0f) pct = 1.0f;
        C2D_DrawRectSolid(20, 110, 0, 280, 20, C2D_Color32(45,55,51,255));
        C2D_DrawRectSolid(22, 112, 0, (unsigned) (276 * pct), 16, C2D_Color32(35,145,88,255));
        drawText(110, 138, .32f, C2D_Color32(220,245,235,255), "%llu / %llu KB", updateProgress / 1024, updateTotal / 1024);
    }

    if (updateState == UPDATE_IDLE || updateState == UPDATE_CHECKING || updateState == UPDATE_AVAILABLE || updateState == UPDATE_ERROR) {
        C2D_DrawRectSolid(10, 166, 0, 300, 24, C2D_Color32(45,105,76,255));
        drawText(80, 171, .34f, C2D_Color32(255,255,255,255), "CHECK FOR UPDATE");
    }
    if (updateState == UPDATE_AVAILABLE) {
        C2D_DrawRectSolid(10, 194, 0, 300, 24, C2D_Color32(35,145,88,255));
        drawText(108, 199, .34f, C2D_Color32(255,255,255,255), "DOWNLOAD");
    }
    if (updateState == UPDATE_READY) {
        C2D_DrawRectSolid(10, 194, 0, 300, 24, C2D_Color32(35,145,88,255));
        drawText(120, 199, .34f, C2D_Color32(255,255,255,255), "INSTALL");
    }
    if (updateState == UPDATE_DONE) {
        C2D_DrawRectSolid(10, 194, 0, 300, 24, C2D_Color32(45,105,76,255));
        drawText(70, 199, .34f, C2D_Color32(255,255,255,255), "EXIT & RELAUNCH");
    }

    if (updateStatus[0] && (!updateStatusUntil || osGetTime() < updateStatusUntil))
        drawText(15, 92, .32f, C2D_Color32(255,220,130,255), "%.46s", updateStatus);
}
