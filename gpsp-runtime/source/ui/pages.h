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
    PAGE_QUESTS,
    PAGE_TITLES,
    PAGE_FRIENDS,
    PAGE_GUILD,
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
    char title[33];
    int16_t x;
    int16_t y;
    int16_t prevX;
    int16_t prevY;
    uint8_t facing;
    bool isGirl;
    uint8_t emote;
    uint64_t emoteUntil;
    uint64_t updatedAt;
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

// Online NPC state from main.cpp.
struct OnlineNpc {
    char npc_id[65];
    char name[33];
    int16_t x;
    int16_t y;
    uint8_t facing;
    char sprite[41];
    char quest_id[37];
};
extern OnlineNpc onlineNpcs[8];
extern unsigned onlineNpcCount;

// World resource node state from main.cpp.
struct ResourceNode {
    char node_id[65];
    char kind[16];
    int16_t x;
    int16_t y;
    uint8_t level;
    bool available;
    uint32_t respawn_in_ms;
};
extern ResourceNode resourceNodes[8];
extern unsigned resourceNodeCount;

// Quest log state from main.cpp.
struct QuestLogEntry {
    char quest_id[37];
    char slug[65];
    char title[121];
    char description[201];
    char status[16];
};
extern QuestLogEntry questLog[8];
extern unsigned questLogCount;
extern unsigned questLogPage;

// Title inventory state from main.cpp.
struct TitleEntry {
    char title[41];
    bool equipped;
};
extern TitleEntry playerTitles[16];
extern unsigned playerTitleCount;
extern unsigned playerTitlePage;
extern unsigned playerTitleSelected;

// Friends list state from main.cpp.
struct FriendEntry {
    char fingerprint[11];
    char name[13];
    char status[16];
    bool is_requester;
    bool online;
    char map[33];
    int16_t x;
    int16_t y;
};
extern FriendEntry playerFriends[32];
extern unsigned playerFriendCount;
extern unsigned playerFriendPage;
extern unsigned playerFriendSelected;

// Guild state from main.cpp.
struct GuildMember {
    char fingerprint[11];
    char identity_id[37];
    char role[8];
};
struct GuildInfo {
    bool active;
    char name[41];
    char tag[7];
    char leader_id[37];
};
extern GuildInfo guildInfo;
extern GuildMember guildMembers[50];
extern unsigned guildMemberCount;
extern unsigned guildMemberPage;

// NPC dialogue overlay state from main.cpp.
struct NpcDialogue {
    bool active;
    char npc_id[65];
    char lines[4][81];
    unsigned lineCount;
    char quest_id[37];
    char quest_title[121];
};
extern NpcDialogue npcDialogue;

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

// Static UI label cache. Init after C2D is ready; shutdown before deleting the
// dynamic text buffer so Citro2D objects are freed in the correct order.
bool initStaticTextCache(void);
void shutdownStaticTextCache(void);

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
void drawQuestPage(void);
void drawTitlesPage(void);
void drawFriendsPage(void);
void drawGuildPage(void);
void drawNpcDialogueOverlay(void);

// Helpers used by the main loop touch dispatch.
unsigned currentChatIndices(unsigned indices[24]);
bool teleportKindMatches(const char* kind);
void recordMapTrail(const GamePresence& current);

// Role helpers used by pages and the online overview.
uint32_t roleColor(const char* role);
const char* roleLabel(const char* role);

#endif
