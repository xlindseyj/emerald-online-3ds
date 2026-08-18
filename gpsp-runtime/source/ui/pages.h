#ifndef EMERALD_ONLINE_PAGES_H
#define EMERALD_ONLINE_PAGES_H

#include <citro2d.h>
#include <3ds.h>
#include <stdarg.h>
#include <stdio.h>
#include <string.h>

// Bottom screen page identifiers.  Keep these in sync with main.cpp.
enum BottomPage {
    PAGE_ONLINE,
    PAGE_USERS,
    PAGE_CHAT,
    PAGE_PARTY,
    PAGE_BAG,
    PAGE_MAP,
    PAGE_STATS,
    PAGE_TELEPORT,
    PAGE_UPDATE
};

// Shared UI resources from main.cpp.
extern C2D_Font uiFont;
extern C2D_TextBuf textBuffer;

// GBA memory pointers from main.cpp.
extern uint8_t* gbaEwram;
extern uint8_t* gbaIwram;

// Online state from main.cpp.
enum OnlineMode { ONLINE_OFFLINE, ONLINE_CONNECTING, ONLINE_ACTIVE };
extern OnlineMode onlineMode;

// Presence / radar state from main.cpp.
struct GamePresence {
    bool valid;
    uint8_t mapGroup;
    uint8_t mapNum;
    int16_t x;
    int16_t y;
    uint8_t facing;
};
extern GamePresence presence;

struct RemoteTrainer {
    char id[37];
    char name[13];
    int16_t x;
    int16_t y;
    uint8_t facing;
    bool isGirl;
    uint8_t emote;
    uint64_t emoteUntil;
};
extern RemoteTrainer remoteTrainers[8];
extern int remoteCount;

struct MapTrailPoint {
    uint8_t mapGroup;
    uint8_t mapNum;
    int16_t x;
    int16_t y;
};
extern MapTrailPoint mapTrail[16];
extern unsigned mapTrailCount;
extern unsigned mapTrailNext;

// Online users state from main.cpp.
struct OnlineUser {
    char id[37];
    char name[13];
    char map[33];
    int16_t x;
    int16_t y;
    bool positioned;
    char role[10];
};
extern OnlineUser onlineUsers[64];
extern unsigned onlineUserCount;
extern unsigned onlineUserPage;

// Chat state from main.cpp.
struct ChatMessage {
    char name[13];
    char map[33];
    char time[7];
    char text[81];
    bool global;
};
extern ChatMessage chatHistory[24];
extern unsigned chatHistoryCount;
extern unsigned chatPage;
extern int chatDetailIndex;
extern bool globalChat;
extern char lastChatName[13];
extern char lastChatText[81];

// Stats state from main.cpp.
struct SaveStats {
    bool valid;
    unsigned seen;
    unsigned caught;
    unsigned badges;
    uint16_t frontier[22];
};
extern SaveStats saveStats;
extern bool statsEnabled;
extern bool statsSeenEnabled;
extern bool statsCaughtEnabled;
extern bool statsBadgesEnabled;
extern bool statsFrontierEnabled;
extern char statsStatus[48];
extern uint64_t statsStatusUntil;

// Teleport state from main.cpp.
struct TeleportDestination {
    char id[65];
    char name[33];
    char kind[16];
};
extern TeleportDestination teleportDestinations[64];
extern unsigned teleportDestinationCount;
extern bool teleportCustomVisible;
extern unsigned teleportCategory;
extern unsigned teleportScroll;
extern int teleportSelectedIndex;
extern uint64_t teleportStatusUntil;
extern char teleportStatus[48];

// Update state from main.cpp.
enum UpdateState {
    UPDATE_IDLE,
    UPDATE_CHECKING,
    UPDATE_AVAILABLE,
    UPDATE_DOWNLOADING,
    UPDATE_VERIFYING,
    UPDATE_READY,
    UPDATE_INSTALLING,
    UPDATE_ERROR,
    UPDATE_DONE
};
extern UpdateState updateState;
extern char updateLatestVersion[16];
extern char updateStatus[64];
extern uint64_t updateStatusUntil;
extern uint64_t updateProgress;
extern uint64_t updateTotal;

// Bag state from main.cpp.
extern unsigned bagPocket;
extern unsigned bagPage;
extern char itemNames[377][15];
extern bool itemNamesLoaded;

// Misc state from main.cpp.
extern char trainerName[13];
extern char identityFingerprint[11];
extern char trainerRole[10];
extern unsigned measuredFps;
extern char recoveryCode[25];
extern char browserPairingStatus[40];
extern uint64_t browserPairingStatusUntil;
extern char serverHost[254];
extern unsigned serverPort;
extern bool linkConfigured;
extern char linkStatus[48];
extern unsigned linkPacketsSent;
extern unsigned linkPacketsReceived;

#define APP_VERSION "0.8.8"

// Common text helper used by pages and the main renderer.
void drawText(float x, float y, float size, uint32_t color, const char* format, ...);

// Emerald save-decoding helpers.
char decodeEmerald(uint8_t value);
bool getSaveBlocks(const uint8_t** block1, const uint8_t** block2);
void loadPrivateItemNames(void);
const char* facingName(uint8_t facing);

// Page renderers.
void drawBagPage(void);
void drawMapPage(void);
void drawStatsPage(void);
void drawOnlineUsersPage(void);
void drawChatPage(void);
void drawTeleportPage(void);
void drawUpdatePage(void);

// Helpers used by the main loop touch dispatch.
unsigned currentChatIndices(unsigned indices[24]);
bool teleportKindMatches(const char* kind);
void recordMapTrail(const GamePresence& current);

// Role helpers used by pages and the online overview.
uint32_t roleColor(const char* role);
const char* roleLabel(const char* role);

#endif
