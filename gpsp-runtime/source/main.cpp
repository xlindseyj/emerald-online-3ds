#include <3ds.h>
#include <3ds/services/am.h>
#include <3ds/applets/swkbd.h>
#include <citro2d.h>
#include <citro3d.h>

#include <arpa/inet.h>
#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <malloc.h>
#include <netdb.h>
#include <netinet/in.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include <mbedtls/base64.h>
#include <mbedtls/sha1.h>
#include <mbedtls/sha256.h>
#include <mbedtls/ssl.h>

#include "ui/pages.h"
#include "network/http_client.h"

extern "C" {
#include <libretro.h>

// Use RetroArch's proven 3DS bootstrap to enable the process-memory SVCs
// before gpSP maps its writable/executable translation caches.
extern unsigned int __ctr_svchax;
Result svchax_init(bool patch_srv);
extern uint8_t gpspEwram[] __asm__("ewram");
extern uint8_t gpspIwram[] __asm__("iwram");
}

#define ROM_PATH "sdmc:/3ds/emerald-online-3ds/emerald.gba"
#define SAVE_PATH "sdmc:/3ds/emerald-online-3ds/emerald.sav"
#define CONFIG_PATH "sdmc:/3ds/emerald-online-3ds/online.cfg"
#define IDENTITY_PATH "sdmc:/3ds/emerald-online-3ds/identity.cfg"
#define IDENTITY_TEMP_PATH "sdmc:/3ds/emerald-online-3ds/identity.cfg.tmp"
#define STATS_CONFIG_PATH "sdmc:/3ds/emerald-online-3ds/stats.cfg"
#define STATS_CONFIG_TEMP_PATH "sdmc:/3ds/emerald-online-3ds/stats.cfg.tmp"
#define LINK_BACKUP_DIRECTORY "sdmc:/3ds/emerald-online-3ds/link-backups"
#define LINK_BACKUP_RETENTION 5
#define DEFAULT_HOST "live.emeraldonline3ds.com"
#define DEFAULT_PORT 443
#define DEFAULT_WEBSOCKET_PATH "/game"
#define SOC_BUFFER_SIZE 0x100000
#define AUDIO_BUFFERS 4
#define AUDIO_FRAMES 1024
#define DEBUG_LOG_PATH "sdmc:/3ds/emerald-online-3ds/gpsp-debug.log"
#define AVATAR_PATH "sdmc:/3ds/emerald-online-3ds/avatars.t3x"
#define UPDATE_DIRECTORY "sdmc:/3ds/emerald-online-3ds/update"
#define UPDATE_CIA_PATH "sdmc:/3ds/emerald-online-3ds/update/emerald-online-3ds.cia"
#define UPDATE_3DSX_PATH "sdmc:/3ds/emerald-online-3ds/update/emerald-online-3ds.3dsx"
#define INSTALLED_3DSX_PATH "sdmc:/3ds/emerald-online-3ds/emerald-online-3ds.3dsx"
#define TOUCH_DEBOUNCE_MS 150

static C3D_RenderTarget* topTarget;
static C3D_RenderTarget* bottomTarget;
static C3D_Tex gameTexture;
static uint16_t* gameUploadBuffer;
static Tex3DS_SubTexture gameSubTex = {240, 160, 0.0f, 1.0f, 240.0f / 256.0f, 1.0f - 160.0f / 256.0f};
static C2D_Image gameImage = {&gameTexture, &gameSubTex};
C2D_Font uiFont;
static C2D_SpriteSheet avatarSheet;
C2D_TextBuf textBuffer;
static const uint16_t* videoPixels;
static size_t videoPitch;
static bool videoReady;
static uint32_t heldKeys;
static uint32_t repeatKeys;
static uint64_t touchDebounceUntil;
static bool quitRequested;
uint8_t* gbaEwram;
uint8_t* gbaIwram;
static uint8_t* saveRam;
static size_t saveRamSize;
static uint32_t saveHash;
static uint64_t nextSaveCheck;
unsigned measuredFps;
static unsigned fpsFrames;
static unsigned renderedFrames;
static uint64_t fpsStarted;
static BottomPage bottomPage = PAGE_ONLINE;
unsigned bagPocket;
unsigned bagPage;
unsigned onlineUserPage;
unsigned chatPage;
bool globalChat;
int chatDetailIndex = -1;
char itemNames[377][15];
bool itemNamesLoaded;
static bool dynarecEnabled = true;
static char linkRoom[10];
bool linkConfigured;
static bool linkJoined;
static bool linkStarted;
static unsigned linkClientId;
static unsigned linkPeerId;
unsigned linkPacketsSent;
unsigned linkPacketsReceived;
char linkStatus[48] = "LINK SPIKE DISABLED";
static const retro_netpacket_callback* coreNetpacketInterface;

static bool onlineSend(const char* message);
static bool receiveOnlineTraffic(void);
static const char* findJsonValue(const char* json, const char* end, const char* key);
static bool jsonStringBounded(const char* json, const char* end, const char* key, char* output, size_t size);
static void checkForUpdate(void);
static void startUpdateDownload(void);
static void installUpdate(void);

static bool inputText(const char* hint, char* output, size_t size, unsigned maxLength) {
    SwkbdState keyboard;
    swkbdInit(&keyboard, SWKBD_TYPE_NORMAL, 2, maxLength);
    if (hint) swkbdSetHintText(&keyboard, hint);
    return swkbdInputText(&keyboard, output, size) == SWKBD_BUTTON_CONFIRM;
}

static void frontendNetpacketSend(int, const void* data, size_t size, uint16_t clientId) {
    if (!linkStarted || !data || !size || size > 512) return;
    static const char hex[] = "0123456789abcdef";
    char encoded[1025];
    const uint8_t* bytes = (const uint8_t*) data;
    for (size_t index = 0; index < size; ++index) {
        encoded[index * 2] = hex[bytes[index] >> 4];
        encoded[index * 2 + 1] = hex[bytes[index] & 15];
    }
    encoded[size * 2] = 0;
    char packet[1152];
    snprintf(packet, sizeof(packet), "{\"type\":\"link_packet\",\"to\":%u,\"data\":\"%s\"}\n", clientId, encoded);
    if (onlineSend(packet)) ++linkPacketsSent;
}

static void frontendNetpacketPollReceive(void) {
    // gpSP calls this while its RFU is waiting for a response. The socket is
    // nonblocking, so drain immediately instead of deferring replies to the
    // 100 ms presence poll and allowing Emerald's RFU handshake to time out.
    if (linkStarted) receiveOnlineTraffic();
}

static void debugStage(const char* stage) {
    FILE* file = fopen(DEBUG_LOG_PATH, "a");
    if (!file) return;
    fprintf(file, "%llu %s\n", (unsigned long long) osGetTime(), stage);
    fclose(file);
}

static ndspWaveBuf audioWaves[AUDIO_BUFFERS];
static int16_t* audioData;
static unsigned audioCursor;
static double audioRate = 32768.0;

OnlineMode onlineMode = ONLINE_OFFLINE;
static int onlineSocket = -1;
static uint32_t* socBuffer;
static bool onlineEnabled = true;
static int onlineLastError;
static uint64_t connectStarted;
static uint64_t nextReconnect;
static uint64_t lastPing;
static uint64_t nextOnlinePoll;
static unsigned onlineSequence;
char serverHost[254] = DEFAULT_HOST;
static in_addr serverAddress = {};
static uint64_t serverAddressResolvedAt;
unsigned serverPort = DEFAULT_PORT;
static bool secureWebSocket = true;
static char webSocketPath[128] = DEFAULT_WEBSOCKET_PATH;
char trainerName[13] = "Trainer";
static bool trainerNameFromSave;
static bool trainerIsGirl;
static char identityId[37];
static char identityToken[65];
static char credentialId[37];
char identityFingerprint[11];
char trainerRole[10] = "player";
char recoveryCode[25];
static char receiveBuffer[4097];
static size_t receiveLength;
static unsigned char webSocketBuffer[8192];
static size_t webSocketLength;
static mbedtls_ssl_context tlsContext;
static bool tlsActive;
static int onlineProtocolStage;
static int onlineTlsResult;
static uint32_t onlineTlsVerify;
int onlineTlsFutureSkew;
char lastChatName[13];
char lastChatText[81];
char browserPairingStatus[40];
uint64_t browserPairingStatusUntil;
bool statsEnabled;
bool statsSeenEnabled;
bool statsCaughtEnabled;
bool statsBadgesEnabled;
bool statsFrontierEnabled;
static bool onlineAuthenticated;
static uint64_t nextStatsUpload;
static uint64_t nextStatsRead;
char statsStatus[48] = "UPLOADS OFF - TAP ENABLE";
uint64_t statsStatusUntil;

SaveStats saveStats;

static void debugNetworkFailure(void) {
    FILE* file = fopen(DEBUG_LOG_PATH, "a");
    if (!file) return;
    fprintf(file, "%llu wss-failed stage=%d tls=%d verify=%08lx skew=%d\n",
        (unsigned long long) osGetTime(), onlineProtocolStage, onlineTlsResult,
        (unsigned long) onlineTlsVerify, onlineTlsFutureSkew);
    fclose(file);
}

GamePresence presence;
GamePresence lastSentPresence;

MapTrailPoint mapTrail[16];
unsigned mapTrailCount;
unsigned mapTrailNext;

RemoteTrainer remoteTrainers[8];
int remoteCount;

OnlineUser onlineUsers[64];
unsigned onlineUserCount;
static unsigned onlineUserExpectedPage;
static unsigned onlineUserExpectedPages;

ChatMessage chatHistory[24];
unsigned chatHistoryCount;

TeleportDestination teleportDestinations[64];
unsigned teleportDestinationCount;
bool teleportCustomVisible;
unsigned teleportCategory;
unsigned teleportScroll;
int teleportSelectedIndex = -1;
uint64_t teleportStatusUntil;
char teleportStatus[48] = "";
static bool teleportLocationsRequested;

UpdateState updateState = UPDATE_IDLE;
char updateLatestVersion[16] = "";
static char updateCiaUrl[192] = "";
static char update3dsxUrl[192] = "";
static char updateCiaSha256[65] = "";
static char update3dsxSha256[65] = "";
char updateStatus[64] = "";
uint64_t updateStatusUntil = 0;
uint64_t updateProgress = 0;
uint64_t updateTotal = 0;
static bool updateIsCia = false;

static void logPrintf(enum retro_log_level level, const char* fmt, ...) {
    (void) level;
    va_list args;
    va_start(args, fmt);
    vprintf(fmt, args);
    va_end(args);
}

static const char* optionValue(const char* key) {
    if (!strcmp(key, "gpsp_drc")) return dynarecEnabled ? "enabled" : "disabled";
    if (!strcmp(key, "gpsp_bios")) return "builtin";
    if (!strcmp(key, "gpsp_boot_mode")) return "game";
    if (!strcmp(key, "gpsp_rtc")) return "auto";
    // Emerald's Direct Corner is not reliable with gpSP's experimental
    // Serial-Poke backend: the client can time out when the actual terminal
    // exchange begins. The RFU backend is gpSP's native Emerald choice and
    // supports the in-game Union Room trade/battle flow.
    if (!strcmp(key, "gpsp_serial")) return linkConfigured ? "rfu" : "disabled";
    if (!strcmp(key, "gpsp_rumble")) return "disabled";
    if (!strcmp(key, "gpsp_sprlim")) return "disabled";
    if (!strcmp(key, "gpsp_sound_rate")) return "32768";
    if (!strcmp(key, "gpsp_frameskip")) return "disabled";
    if (!strcmp(key, "gpsp_frameskip_threshold")) return "33";
    if (!strcmp(key, "gpsp_frameskip_interval")) return "0";
    if (!strcmp(key, "gpsp_color_correction")) return "disabled";
    if (!strcmp(key, "gpsp_frame_mixing")) return "disabled";
    if (!strcmp(key, "gpsp_turbo_period")) return "4";
    return NULL;
}

static bool environmentCallback(unsigned command, void* data) {
    switch (command) {
    case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT:
        return *(enum retro_pixel_format*) data == RETRO_PIXEL_FORMAT_RGB565;
    case RETRO_ENVIRONMENT_GET_CAN_DUPE:
        if (data) *(bool*) data = true;
        return true;
    case RETRO_ENVIRONMENT_GET_INPUT_BITMASKS:
        // The libretro API uses the return value as the capability signal;
        // gpSP intentionally probes this command with a null data pointer.
        return true;
    case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
    case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY:
        *(const char**) data = "sdmc:/3ds/emerald-online-3ds";
        return true;
    case RETRO_ENVIRONMENT_GET_LOG_INTERFACE:
        ((retro_log_callback*) data)->log = logPrintf;
        return true;
    case RETRO_ENVIRONMENT_GET_VARIABLE: {
        retro_variable* variable = (retro_variable*) data;
        variable->value = optionValue(variable->key);
        return variable->value != NULL;
    }
    case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE:
        *(bool*) data = false;
        return true;
    case RETRO_ENVIRONMENT_SET_MEMORY_MAPS: {
        retro_memory_map* map = (retro_memory_map*) data;
        for (unsigned i = 0; i < map->num_descriptors; ++i) {
            const retro_memory_descriptor* desc = &map->descriptors[i];
            if (desc->start == 0x02000000) gbaEwram = (uint8_t*) desc->ptr + desc->offset;
            if (desc->start == 0x03000000) gbaIwram = (uint8_t*) desc->ptr + desc->offset;
        }
        return true;
    }
    case RETRO_ENVIRONMENT_SET_NETPACKET_INTERFACE: {
        const retro_netpacket_callback* interface = (const retro_netpacket_callback*) data;
        if (!interface || !interface->start || !interface->receive) return false;
        coreNetpacketInterface = interface;
        return true;
    }
    case RETRO_ENVIRONMENT_SET_MESSAGE:
    case RETRO_ENVIRONMENT_SET_MESSAGE_EXT:
    case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS:
    case RETRO_ENVIRONMENT_SET_PERFORMANCE_LEVEL:
    case RETRO_ENVIRONMENT_SET_SUPPORT_ACHIEVEMENTS:
    case RETRO_ENVIRONMENT_SET_MINIMUM_AUDIO_LATENCY:
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS:
    case RETRO_ENVIRONMENT_SET_CORE_OPTIONS_INTL:
    case RETRO_ENVIRONMENT_SET_VARIABLES:
        return true;
    case RETRO_ENVIRONMENT_GET_MESSAGE_INTERFACE_VERSION:
        *(unsigned*) data = 1;
        return true;
    case RETRO_ENVIRONMENT_SHUTDOWN:
        quitRequested = true;
        return true;
    default:
        return false;
    }
}

static void videoCallback(const void* data, unsigned width, unsigned height, size_t pitch) {
    if (data && width == 240 && height == 160) {
        videoPixels = (const uint16_t*) data;
        videoPitch = pitch;
        videoReady = true;
    }
}

static void audioSampleCallback(int16_t left, int16_t right) {
    int16_t pair[2] = {left, right};
    (void) pair;
}

static size_t audioBatchCallback(const int16_t* data, size_t frames) {
    if (!audioData) return frames;
    for (unsigned attempt = 0; attempt < AUDIO_BUFFERS; ++attempt) {
        unsigned index = (audioCursor + attempt) % AUDIO_BUFFERS;
        if (audioWaves[index].status == NDSP_WBUF_FREE || audioWaves[index].status == NDSP_WBUF_DONE) {
            size_t count = frames > AUDIO_FRAMES ? AUDIO_FRAMES : frames;
            memcpy(&audioData[index * AUDIO_FRAMES * 2], data, count * 2 * sizeof(int16_t));
            memset(&audioWaves[index], 0, sizeof(audioWaves[index]));
            audioWaves[index].data_pcm16 = &audioData[index * AUDIO_FRAMES * 2];
            audioWaves[index].nsamples = count;
            DSP_FlushDataCache(audioWaves[index].data_pcm16, count * 2 * sizeof(int16_t));
            ndspChnWaveBufAdd(0, &audioWaves[index]);
            audioCursor = (index + 1) % AUDIO_BUFFERS;
            break;
        }
    }
    return frames;
}

static void inputPollCallback(void) {}

static int16_t inputStateCallback(unsigned port, unsigned device, unsigned index, unsigned id) {
    if (port || index || device != RETRO_DEVICE_JOYPAD) return 0;
    if (id == RETRO_DEVICE_ID_JOYPAD_MASK) {
        uint16_t result = 0;
        for (unsigned button = 0; button < 16; ++button) if (inputStateCallback(0, device, 0, button)) result |= 1u << button;
        return result;
    }
    uint32_t key = 0;
    switch (id) {
    case RETRO_DEVICE_ID_JOYPAD_A: key = KEY_A; break;
    case RETRO_DEVICE_ID_JOYPAD_B: key = KEY_B; break;
    case RETRO_DEVICE_ID_JOYPAD_START: key = KEY_START; break;
    case RETRO_DEVICE_ID_JOYPAD_SELECT: key = KEY_SELECT; break;
    case RETRO_DEVICE_ID_JOYPAD_UP: key = KEY_UP | KEY_CPAD_UP; break;
    case RETRO_DEVICE_ID_JOYPAD_DOWN: key = KEY_DOWN | KEY_CPAD_DOWN; break;
    case RETRO_DEVICE_ID_JOYPAD_LEFT: key = KEY_LEFT | KEY_CPAD_LEFT; break;
    case RETRO_DEVICE_ID_JOYPAD_RIGHT: key = KEY_RIGHT | KEY_CPAD_RIGHT; break;
    case RETRO_DEVICE_ID_JOYPAD_L: key = KEY_L; break;
    case RETRO_DEVICE_ID_JOYPAD_R: key = KEY_R; break;
    default: return 0;
    }
    return (heldKeys & key) != 0;
}

static uint32_t hashBytes(const uint8_t* data, size_t size) {
    uint32_t hash = 2166136261u;
    for (size_t i = 0; i < size; ++i) hash = (hash ^ data[i]) * 16777619u;
    return hash;
}

static void loadSave(void) {
    saveRam = (uint8_t*) retro_get_memory_data(RETRO_MEMORY_SAVE_RAM);
    saveRamSize = retro_get_memory_size(RETRO_MEMORY_SAVE_RAM);
    FILE* file = fopen(SAVE_PATH, "rb");
    if (file && saveRam) {
        size_t count = fread(saveRam, 1, saveRamSize, file);
        if (count < saveRamSize) memset(saveRam + count, 0xFF, saveRamSize - count);
        fclose(file);
    }
    if (saveRam) saveHash = hashBytes(saveRam, saveRamSize);
}

static bool writeSave(bool force) {
    if (!saveRam || !saveRamSize) return false;
    uint32_t hash = hashBytes(saveRam, saveRamSize);
    if (!force && hash == saveHash) return true;
    FILE* file = fopen(SAVE_PATH ".tmp", "wb");
    if (!file) return false;
    bool good = fwrite(saveRam, 1, saveRamSize, file) == saveRamSize;
    if (good && (fflush(file) || fsync(fileno(file)))) good = false;
    if (fclose(file)) good = false;
    if (good) {
        remove(SAVE_PATH);
        good = rename(SAVE_PATH ".tmp", SAVE_PATH) == 0;
        if (good) saveHash = hash;
    }
    if (!good) remove(SAVE_PATH ".tmp");
    return good;
}

struct LinkBackupEntry { char name[128]; };

static int compareLinkBackups(const void* left, const void* right) {
    return strcmp(((const LinkBackupEntry*) left)->name, ((const LinkBackupEntry*) right)->name);
}

static bool verifyEmeraldSaveFile(const char* path);

static bool backupSaveForLink(void) {
    if (!writeSave(true) || !verifyEmeraldSaveFile(SAVE_PATH) || (mkdir(LINK_BACKUP_DIRECTORY, 0700) && errno != EEXIST)) return false;
    FILE* source = fopen(SAVE_PATH, "rb");
    if (!source) return false;
    char path[256];
    snprintf(path, sizeof(path), LINK_BACKUP_DIRECTORY "/emerald-link-%lld-%llu.sav",
        (long long) time(NULL), (unsigned long long) osGetTime());
    FILE* destination = fopen(path, "wb");
    bool good = destination != NULL;
    uint8_t buffer[4096];
    while (good) {
        size_t count = fread(buffer, 1, sizeof(buffer), source);
        if (count && fwrite(buffer, 1, count, destination) != count) good = false;
        if (count < sizeof(buffer)) { if (ferror(source)) good = false; break; }
    }
    if (fclose(source)) good = false;
    if (destination) {
        if (good && (fflush(destination) || fsync(fileno(destination)))) good = false;
        if (fclose(destination)) good = false;
    }
    if (!good || !verifyEmeraldSaveFile(path)) {
        remove(path);
        return false;
    }

    DIR* directory = opendir(LINK_BACKUP_DIRECTORY);
    if (!directory) return false;
    LinkBackupEntry entries[64] = {};
    size_t count = 0;
    dirent* item;
    while ((item = readdir(directory)) && count < 64) {
        const size_t length = strlen(item->d_name);
        if (length < 18 || strncmp(item->d_name, "emerald-link-", 13) || strcmp(item->d_name + length - 4, ".sav")) continue;
        strncpy(entries[count++].name, item->d_name, sizeof(entries[0].name) - 1);
    }
    closedir(directory);
    qsort(entries, count, sizeof(entries[0]), compareLinkBackups);
    for (size_t index = 0; index + LINK_BACKUP_RETENTION < count; ++index) {
        const size_t prefixLength = strlen(LINK_BACKUP_DIRECTORY);
        memcpy(path, LINK_BACKUP_DIRECTORY, prefixLength);
        path[prefixLength] = '/';
        strncpy(path + prefixLength + 1, entries[index].name, sizeof(path) - prefixLength - 2);
        path[sizeof(path) - 1] = 0;
        remove(path);
    }
    return true;
}

static bool restoreSaveFromBackup(const char* backupPath) {
    if (!backupPath || !verifyEmeraldSaveFile(backupPath)) return false;
    FILE* source = fopen(backupPath, "rb");
    if (!source) return false;
    FILE* destination = fopen(SAVE_PATH ".tmp", "wb");
    if (!destination) { fclose(source); return false; }
    bool good = true;
    uint8_t buffer[4096];
    size_t count;
    while (good && (count = fread(buffer, 1, sizeof(buffer), source)) > 0)
        if (fwrite(buffer, 1, count, destination) != count) good = false;
    if (ferror(source)) good = false;
    if (fflush(destination) || fsync(fileno(destination))) good = false;
    fclose(source); fclose(destination);
    if (!good || rename(SAVE_PATH ".tmp", SAVE_PATH) != 0) {
        remove(SAVE_PATH ".tmp");
        return false;
    }
    if (!verifyEmeraldSaveFile(SAVE_PATH)) {
        // The active save is now corrupt; we cannot roll back automatically
        // because backupPath was already verified. Caller must handle this.
        return false;
    }
    loadSave();
    return true;
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

static constexpr size_t EMERALD_SAVE_BYTES = 128 * 1024;
static constexpr size_t EMERALD_EMULATOR_FOOTER_BYTES = 512;
static constexpr size_t EMERALD_SECTOR_BYTES = 0x1000;
static constexpr size_t EMERALD_SECTOR_DATA_BYTES = 0xF80;
static constexpr unsigned EMERALD_SECTORS_PER_SLOT = 14;
static constexpr uint32_t EMERALD_SECTOR_SIGNATURE = 0x08012025;
static constexpr uint16_t EMERALD_SECTION_SIZES[EMERALD_SECTORS_PER_SLOT] = {
    0xF2C, 0xF80, 0xF80, 0xF80, 0xF08,
    0xF80, 0xF80, 0xF80, 0xF80, 0xF80,
    0xF80, 0xF80, 0xF80, 0x7D0
};

static uint16_t emeraldSectorChecksum(const uint8_t* sector) {
    uint32_t sum = 0;
    for (size_t offset = 0; offset + 4 <= EMERALD_SECTION_SIZES[read16(sector, 0xFF4)]; offset += 4)
        sum += read32(sector, offset);
    return (uint16_t)(((sum >> 16) + (sum & 0xFFFF)) & 0xFFFF);
}

static bool emeraldSectorValid(const uint8_t* sector) {
    uint16_t id = read16(sector, 0xFF4);
    if (id >= EMERALD_SECTORS_PER_SLOT) return false;
    uint16_t stored = read16(sector, 0xFF6);
    uint32_t signature = read32(sector, 0xFF8);
    return signature == EMERALD_SECTOR_SIGNATURE && stored == emeraldSectorChecksum(sector);
}

static bool verifyEmeraldSaveFile(const char* path) {
    FILE* file = fopen(path, "rb");
    if (!file) return false;
    if (fseek(file, 0, SEEK_END)) { fclose(file); return false; }
    long size = ftell(file);
    if (size != (long)EMERALD_SAVE_BYTES && size != (long)(EMERALD_SAVE_BYTES + EMERALD_EMULATOR_FOOTER_BYTES)) {
        fclose(file);
        return false;
    }
    if (fseek(file, 0, SEEK_SET)) { fclose(file); return false; }
    uint8_t* buffer = (uint8_t*) malloc(EMERALD_SAVE_BYTES);
    if (!buffer) { fclose(file); return false; }
    bool ok = fread(buffer, 1, EMERALD_SAVE_BYTES, file) == EMERALD_SAVE_BYTES;
    fclose(file);
    if (ok) {
        ok = false;
        for (unsigned slot = 0; slot < 2 && !ok; ++slot) {
            bool slotValid = true;
            for (unsigned index = 0; index < EMERALD_SECTORS_PER_SLOT && slotValid; ++index) {
                const size_t offset = (slot * EMERALD_SECTORS_PER_SLOT + index) * EMERALD_SECTOR_BYTES;
                if (!emeraldSectorValid(buffer + offset)) slotValid = false;
            }
            if (slotValid) ok = true;
        }
    }
    free(buffer);
    return ok;
}

// Supported Pokemon Emerald (US) runtime symbols. The private-ROM validator
// accepts only the exact BPEE revision these addresses describe. Function
// pointers are Thumb addresses, so callback2 stores CB2_Overworld + 1.
static constexpr size_t EMERALD_GMAIN_OFFSET = 0x22C0;
static constexpr size_t EMERALD_GMAIN_CALLBACK2_OFFSET = EMERALD_GMAIN_OFFSET + 0x4;
static constexpr size_t EMERALD_GMAIN_FLAGS_OFFSET = EMERALD_GMAIN_OFFSET + 0x439;
static constexpr uint32_t EMERALD_CB2_OVERWORLD_THUMB = 0x08085E5D;

static bool isEmeraldNativeMultiplayerMap(void) {
    if (!gbaEwram || !gbaIwram) return false;
    const uint32_t saveBlock = read32(gbaIwram, 0x5D8C);
    if (saveBlock < 0x02000000 || saveBlock > 0x0203FFF7) return false;
    const size_t offset = saveBlock - 0x02000000;
    const uint8_t mapGroup = gbaEwram[offset + 4];
    const uint8_t mapNum = gbaEwram[offset + 5];
    // Emerald's IndoorDynamic native multiplayer maps: 2P Colosseum,
    // Trade Center, Record Corner, 4P Colosseum, and Union Room.
    // The game owns every avatar in these scenes; drawing presence sprites
    // here would duplicate or obscure Emerald's RFU/link participants.
    return mapGroup == 25 && ((mapNum >= 24 && mapNum <= 27) || mapNum == 60);
}

static bool isEmeraldOverworld(void) {
    if (!gbaIwram) return false;
    const uint32_t callback2 = read32(gbaIwram, EMERALD_GMAIN_CALLBACK2_OFFSET);
    const bool inBattle = (gbaIwram[EMERALD_GMAIN_FLAGS_OFFSET] & 0x02) != 0;
    return callback2 == EMERALD_CB2_OVERWORLD_THUMB && !inBattle && !isEmeraldNativeMultiplayerMap();
}

static void onlineDisconnect(void);

static GamePresence readPresence(void) {
    static GamePresence previous = {false, 0, 0, 0, 0, 1};
    GamePresence current = {false, 0, 0, 0, 0, (uint8_t) (previous.facing ? previous.facing : 1)};
    if (!gbaEwram || !gbaIwram) return current;
    const uint32_t callback2 = read32(gbaIwram, EMERALD_GMAIN_CALLBACK2_OFFSET);
    const bool inBattle = (gbaIwram[EMERALD_GMAIN_FLAGS_OFFSET] & 0x02) != 0;
    if (callback2 != EMERALD_CB2_OVERWORLD_THUMB || inBattle) return current;
    uint32_t saveBlock = read32(gbaIwram, 0x5D8C);
    if (saveBlock < 0x02000000 || saveBlock > 0x0203FFF7) return current;
    size_t offset = saveBlock - 0x02000000;
    current.x = (int16_t) read16(gbaEwram, offset);
    current.y = (int16_t) read16(gbaEwram, offset + 2);
    current.mapGroup = gbaEwram[offset + 4];
    current.mapNum = gbaEwram[offset + 5];
    current.valid = current.x >= 0 && current.x < 4096 && current.y >= 0 && current.y < 4096;
    if (current.valid && previous.valid && current.mapGroup == previous.mapGroup && current.mapNum == previous.mapNum) {
        int dx = current.x - previous.x, dy = current.y - previous.y;
        if (dx == 1 && !dy) current.facing = 4;
        else if (dx == -1 && !dy) current.facing = 3;
        else if (dy == 1 && !dx) current.facing = 1;
        else if (dy == -1 && !dx) current.facing = 2;
    }
    if (current.valid) previous = current;
    return current;
}

static void applyTeleport(uint8_t mapGroup, uint8_t mapNum, int16_t x, int16_t y, uint8_t facing) {
    if (!gbaEwram || !gbaIwram) return;
    uint32_t saveBlock = read32(gbaIwram, 0x5D8C);
    if (saveBlock < 0x02000000 || saveBlock > 0x0203FFF7) return;
    size_t offset = saveBlock - 0x02000000;
    gbaEwram[offset + 0] = (uint8_t)(x & 0xFF);
    gbaEwram[offset + 1] = (uint8_t)((x >> 8) & 0xFF);
    gbaEwram[offset + 2] = (uint8_t)(y & 0xFF);
    gbaEwram[offset + 3] = (uint8_t)((y >> 8) & 0xFF);
    gbaEwram[offset + 4] = mapGroup;
    gbaEwram[offset + 5] = mapNum;
    // TODO: trigger Emerald to reload the map after coordinates change.
    // The current implementation writes gSaveBlock1Ptr location fields.
    // A follow-up step will identify the IWRAM warp flag or call the
    // SetWarpDestination/WarpIntoMap Thumb functions to force a transition.
    (void) facing;
}

static bool parseVersion(const char* text, unsigned* major, unsigned* minor, unsigned* micro) {
    if (!text || !major || !minor || !micro) return false;
    char* end = nullptr;
    unsigned long a = strtoul(text, &end, 10);
    if (end == text || *end != '.') return false;
    unsigned long b = strtoul(end + 1, &end, 10);
    if (*end != '.') return false;
    unsigned long c = strtoul(end + 1, &end, 10);
    if (*end && *end != '-' && *end != '+') return false;
    *major = (unsigned) a; *minor = (unsigned) b; *micro = (unsigned) c;
    return true;
}

static int compareVersion(const char* left, const char* right) {
    unsigned lm, ln, lo, rm, rn, ro;
    if (!parseVersion(left, &lm, &ln, &lo)) return 0;
    if (!parseVersion(right, &rm, &rn, &ro)) return 0;
    if (lm != rm) return lm < rm ? -1 : 1;
    if (ln != rn) return ln < rn ? -1 : 1;
    if (lo != ro) return lo < ro ? -1 : 1;
    return 0;
}

static bool sha256File(const char* path, char hex[65]) {
    FILE* file = fopen(path, "rb");
    if (!file) return false;
    mbedtls_sha256_context ctx;
    mbedtls_sha256_init(&ctx);
    mbedtls_sha256_starts_ret(&ctx, 0);
    uint8_t buffer[4096];
    size_t count;
    while ((count = fread(buffer, 1, sizeof(buffer), file)) > 0)
        mbedtls_sha256_update_ret(&ctx, buffer, count);
    bool readOk = !ferror(file);
    fclose(file);
    uint8_t digest[32];
    if (mbedtls_sha256_finish_ret(&ctx, digest)) readOk = false;
    mbedtls_sha256_free(&ctx);
    if (!readOk) return false;
    static const char hexChars[] = "0123456789abcdef";
    for (unsigned i = 0; i < 32; ++i) {
        hex[i * 2] = hexChars[digest[i] >> 4];
        hex[i * 2 + 1] = hexChars[digest[i] & 15];
    }
    hex[64] = 0;
    return true;
}

static bool hexEqualCaseInsensitive(const char* left, const char* right) {
    if (!left || !right) return false;
    if (strlen(left) != strlen(right)) return false;
    for (size_t i = 0; left[i] && right[i]; ++i) {
        char lc = tolower((unsigned char) left[i]);
        char rc = tolower((unsigned char) right[i]);
        if (lc != rc) return false;
    }
    return true;
}

static void updateSetStatus(const char* fmt, ...) {
    va_list args;
    va_start(args, fmt);
    vsnprintf(updateStatus, sizeof(updateStatus), fmt, args);
    va_end(args);
    updateStatusUntil = osGetTime() + 5000;
}

static bool installCia(const char* ciaPath) {
    if (R_FAILED(amInit())) return false;
    Handle handle;
    if (R_FAILED(AM_StartCiaInstall(MEDIATYPE_SD, &handle))) { amExit(); return false; }
    FILE* file = fopen(ciaPath, "rb");
    if (!file) { AM_CancelCIAInstall(handle); amExit(); return false; }
    bool ok = true;
    uint8_t buffer[4096];
    size_t count;
    u64 offset = 0;
    while (ok && (count = fread(buffer, 1, sizeof(buffer), file)) > 0) {
        u32 written = 0;
        if (R_FAILED(FSFILE_Write(handle, &written, offset, buffer, (u32) count, FS_WRITE_FLUSH)) || written != count) ok = false;
        offset += written;
    }
    if (ferror(file)) ok = false;
    fclose(file);
    bool finishOk = ok && R_SUCCEEDED(AM_FinishCiaInstall(handle));
    if (!ok) AM_CancelCIAInstall(handle);
    amExit();
    return finishOk;
}

static bool replace3dsx(const char* sourcePath) {
    // Keep the current 3DSX as a backup until the next successful launch.
    char backupPath[128];
    snprintf(backupPath, sizeof(backupPath), "%s.bak", INSTALLED_3DSX_PATH);
    remove(backupPath);
    rename(INSTALLED_3DSX_PATH, backupPath);
    FILE* src = fopen(sourcePath, "rb");
    if (!src) { rename(backupPath, INSTALLED_3DSX_PATH); return false; }
    FILE* dst = fopen(INSTALLED_3DSX_PATH ".tmp", "wb");
    if (!dst) { fclose(src); rename(backupPath, INSTALLED_3DSX_PATH); return false; }
    bool ok = true;
    uint8_t buffer[4096];
    size_t count;
    while (ok && (count = fread(buffer, 1, sizeof(buffer), src)) > 0)
        if (fwrite(buffer, 1, count, dst) != count) ok = false;
    if (ferror(src)) ok = false;
    if (fflush(dst) || fsync(fileno(dst))) ok = false;
    fclose(src); fclose(dst);
    if (!ok) { remove(INSTALLED_3DSX_PATH ".tmp"); rename(backupPath, INSTALLED_3DSX_PATH); return false; }
    if (rename(INSTALLED_3DSX_PATH ".tmp", INSTALLED_3DSX_PATH) != 0) { remove(INSTALLED_3DSX_PATH ".tmp"); rename(backupPath, INSTALLED_3DSX_PATH); return false; }
    return true;
}

static bool parseReleaseJson(const char* json, size_t length) {
    const char* end = json + length;
    if (!findJsonValue(json, end, "version")) return false;
    jsonStringBounded(json, end, "version", updateLatestVersion, sizeof(updateLatestVersion));
    jsonStringBounded(json, end, "cia_url", updateCiaUrl, sizeof(updateCiaUrl));
    jsonStringBounded(json, end, "threedsx_url", update3dsxUrl, sizeof(update3dsxUrl));
    jsonStringBounded(json, end, "sha256_cia", updateCiaSha256, sizeof(updateCiaSha256));
    jsonStringBounded(json, end, "sha256_threedsx", update3dsxSha256, sizeof(update3dsxSha256));
    return updateLatestVersion[0] != 0;
}

static void buildReleaseUrl(char* out, size_t size) {
    if (strncmp(serverHost, "https://", 8) == 0)
        snprintf(out, size, "%s/api/release", serverHost);
    else
        snprintf(out, size, "https://%s/api/release", serverHost);
}

static void checkForUpdate(void) {
    updateState = UPDATE_CHECKING;
    updateSetStatus("CHECKING FOR UPDATE...");

    char url[256];
    buildReleaseUrl(url, sizeof(url));
    char tmpPath[128];
    snprintf(tmpPath, sizeof(tmpPath), "%s/release.json", UPDATE_DIRECTORY);
    uint64_t downloaded = 0, total = 0;
    if (!httpDownloadFile(url, tmpPath, &downloaded, &total)) {
        updateState = UPDATE_ERROR;
        updateSetStatus("UPDATE CHECK FAILED");
        return;
    }
    FILE* file = fopen(tmpPath, "rb");
    if (!file) { updateState = UPDATE_ERROR; updateSetStatus("UPDATE CHECK FAILED"); return; }
    char json[2048];
    size_t len = fread(json, 1, sizeof(json) - 1, file);
    fclose(file);
    remove(tmpPath);
    if (len == 0 || !parseReleaseJson(json, len)) {
        updateState = UPDATE_ERROR;
        updateSetStatus("UPDATE RESPONSE INVALID");
        return;
    }
    if (compareVersion(updateLatestVersion, APP_VERSION) <= 0) {
        updateState = UPDATE_IDLE;
        updateSetStatus("UP TO DATE - %s", APP_VERSION);
        return;
    }
    updateState = UPDATE_AVAILABLE;
    updateSetStatus("UPDATE %s AVAILABLE", updateLatestVersion);
}

static void startUpdateDownload(void) {
    updateState = UPDATE_DOWNLOADING;
    updateProgress = 0;
    updateTotal = 0;
    updateSetStatus("DOWNLOADING...");

    // Prefer CIA install when AM is available; otherwise stage 3DSX replacement.
    updateIsCia = true;
    const char* url = updateCiaUrl;
    const char* expectedHash = updateCiaSha256;
    const char* outputPath = UPDATE_CIA_PATH;
    if (!url[0] || !expectedHash[0]) {
        updateIsCia = false;
        url = update3dsxUrl;
        expectedHash = update3dsxSha256;
        outputPath = UPDATE_3DSX_PATH;
    }

    if (!httpDownloadFile(url, outputPath, &updateProgress, &updateTotal)) {
        updateState = UPDATE_ERROR;
        updateSetStatus("DOWNLOAD FAILED");
        return;
    }

    updateState = UPDATE_VERIFYING;
    updateSetStatus("VERIFYING...");
    char hash[65];
    if (!sha256File(outputPath, hash) || !hexEqualCaseInsensitive(hash, expectedHash)) {
        remove(outputPath);
        updateState = UPDATE_ERROR;
        updateSetStatus("HASH MISMATCH");
        return;
    }

    updateState = UPDATE_READY;
    updateSetStatus("READY - TAP INSTALL");
}

static void installUpdate(void) {
    updateState = UPDATE_INSTALLING;
    updateSetStatus("INSTALLING...");
    bool ok = updateIsCia ? installCia(UPDATE_CIA_PATH) : replace3dsx(UPDATE_3DSX_PATH);
    if (!ok) {
        updateState = UPDATE_ERROR;
        updateSetStatus("INSTALL FAILED");
        return;
    }
    updateState = UPDATE_DONE;
    updateSetStatus("DONE - EXIT & RELAUNCH");
}

static unsigned countDexFlags(const uint8_t* flags) {
    unsigned count = 0;
    for (unsigned index = 0; index < 386; ++index) if (flags[index >> 3] & (1u << (index & 7))) ++count;
    return count;
}

static SaveStats readSaveStats(void) {
    SaveStats result = {};
    if (!gbaEwram || !gbaIwram) return result;
    uint32_t block1Address = read32(gbaIwram, 0x5D8C);
    uint32_t block2Address = read32(gbaIwram, 0x5D90);
    if (block1Address < 0x02000000 || block1Address + 0x3D88 > 0x02040000 ||
        block2Address < 0x02000000 || block2Address + 0xF2C > 0x02040000) return result;
    const uint8_t* block1 = gbaEwram + block1Address - 0x02000000;
    const uint8_t* block2 = gbaEwram + block2Address - 0x02000000;
    result.caught = countDexFlags(block2 + 0x28);
    result.seen = countDexFlags(block2 + 0x5C);
    if (result.caught > result.seen || result.seen > 386) return SaveStats{};
    for (unsigned flag = 0x867; flag <= 0x86E; ++flag)
        if (block1[0x1270 + (flag >> 3)] & (1u << (flag & 7))) ++result.badges;
    // SaveBlock2 Battle Frontier streaks. Only single/double modes are
    // included; Multi and Link Multi are deliberately not uploaded.
    static const size_t pairedOffsets[] = {0xCE0, 0xD0C, 0xDC8, 0xDE2};
    unsigned output = 0;
    for (size_t offset : pairedOffsets) for (unsigned mode = 0; mode < 2; ++mode) for (unsigned level = 0; level < 2; ++level)
        result.frontier[output++] = read16(block2, offset + (mode * 2 + level) * 2);
    static const size_t singleOffsets[] = {0xDDA, 0xE04, 0xE1A};
    for (size_t offset : singleOffsets) for (unsigned level = 0; level < 2; ++level)
        result.frontier[output++] = read16(block2, offset + level * 2);
    for (unsigned index = 0; index < output; ++index) if (result.frontier[index] > 9999) return SaveStats{};
    result.valid = true;
    return result;
}

static void updateTrainerNameFromSave(void) {
    if (trainerNameFromSave || !gbaEwram || !gbaIwram) return;
    // Pokemon Emerald (US): gSaveBlock2Ptr at IWRAM 0x03005D90;
    // SaveBlock2 begins with the eight-byte, EOS-terminated player name.
    uint32_t saveBlock2 = read32(gbaIwram, 0x5D90);
    if (saveBlock2 < 0x02000000 || saveBlock2 + 8 > 0x02040000) return;
    size_t offset = saveBlock2 - 0x02000000;
    char decoded[13] = {};
    unsigned count = 0;
    for (; count < 8; ++count) {
        uint8_t value = gbaEwram[offset + count];
        if (value == 0xFF) break;
        char character = decodeEmerald(value);
        if (character == '?' || character == ' ') return;
        decoded[count] = character;
    }
    if (!count || count == 8) return;
    decoded[count] = 0;
    if (strcmp(decoded, trainerName)) {
        strcpy(trainerName, decoded);
        if (onlineMode != ONLINE_OFFLINE) {
            onlineDisconnect();
            nextReconnect = 0;
        }
    }
    trainerIsGirl = gbaEwram[offset + 8] == 1;
    trainerNameFromSave = true;
    debugStage("trainer-name-from-save");
}

static int onlineWriteBytes(const unsigned char* data, size_t size) {
    size_t written = 0;
    unsigned waits = 0;
    while (written < size) {
        int count = tlsActive
            ? mbedtls_ssl_write(&tlsContext, data + written, size - written)
            : (int) send(onlineSocket, data + written, size - written, MSG_NOSIGNAL);
        if (count > 0) {
            written += (size_t) count;
            waits = 0;
            continue;
        }
        if ((tlsActive && (count == MBEDTLS_ERR_SSL_WANT_READ || count == MBEDTLS_ERR_SSL_WANT_WRITE)) ||
            (!tlsActive && count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR))) {
            if (++waits > 250) return -1;
            svcSleepThread(1000000);
            continue;
        }
        return -1;
    }
    return (int) written;
}

static bool webSocketWriteFrame(uint8_t opcode, const unsigned char* payload, size_t size) {
    if (size > 65535) return false;
    unsigned char frame[6 + 4096];
    if (size > sizeof(frame) - 6) return false;
    size_t header = 0;
    frame[header++] = 0x80 | opcode;
    if (size < 126) frame[header++] = 0x80 | (unsigned char) size;
    else {
        frame[header++] = 0x80 | 126;
        frame[header++] = (unsigned char) (size >> 8);
        frame[header++] = (unsigned char) size;
    }
    unsigned char mask[4];
    if (mbedtls_ctr_drbg_random(&tlsRandom, mask, sizeof(mask))) return false;
    memcpy(frame + header, mask, sizeof(mask));
    header += sizeof(mask);
    for (size_t i = 0; i < size; ++i) frame[header + i] = payload[i] ^ mask[i & 3];
    return onlineWriteBytes(frame, header + size) == (int) (header + size);
}

static bool asciiCaseEqual(const char* left, size_t leftSize, const char* right) {
    size_t rightSize = strlen(right);
    if (leftSize != rightSize) return false;
    for (size_t index = 0; index < leftSize; ++index)
        if (tolower((unsigned char) left[index]) != tolower((unsigned char) right[index])) return false;
    return true;
}

// HTTP field names are case-insensitive. Some edge proxies emit
// "Sec-Websocket-Accept", while other servers may emit
// "Sec-WebSocket-Accept". Compare the name case-insensitively but preserve the
// case-sensitive base64 accept value.
static bool webSocketHeaderEquals(const char* response, const char* name, const char* expected) {
    const char* line = strstr(response, "\r\n");
    if (!line) return false;
    line += 2;
    while (*line) {
        const char* end = strstr(line, "\r\n");
        if (!end || end == line) break;
        const char* colon = (const char*) memchr(line, ':', (size_t) (end - line));
        if (colon && asciiCaseEqual(line, (size_t) (colon - line), name)) {
            const char* value = colon + 1;
            while (value < end && (*value == ' ' || *value == '\t')) ++value;
            while (end > value && (end[-1] == ' ' || end[-1] == '\t')) --end;
            return (size_t) (end - value) == strlen(expected) && !memcmp(value, expected, strlen(expected));
        }
        line = end + 2;
    }
    return false;
}

static bool startSecureWebSocket(void) {
    onlineProtocolStage = 1;
    onlineTlsResult = 0;
    onlineTlsVerify = 0;
    onlineTlsFutureSkew = 0;
    if (!httpClientInit()) return false;
    onlineProtocolStage = 2;
    if ((onlineTlsResult = mbedtls_ssl_session_reset(&tlsContext)) ||
        (onlineTlsResult = mbedtls_ssl_set_hostname(&tlsContext, serverHost))) return false;
    mbedtls_ssl_set_bio(&tlsContext, &onlineSocket, httpTlsSocketSend, httpTlsSocketReceive, NULL);

    onlineProtocolStage = 3;
    uint64_t deadline = osGetTime() + 8000;
    int result;
    while ((result = mbedtls_ssl_handshake(&tlsContext)) != 0) {
        onlineTlsResult = result;
        if (result != MBEDTLS_ERR_SSL_WANT_READ && result != MBEDTLS_ERR_SSL_WANT_WRITE) {
            onlineTlsVerify = mbedtls_ssl_get_verify_result(&tlsContext);
            return false;
        }
        if (osGetTime() >= deadline) {
            onlineTlsResult = MBEDTLS_ERR_SSL_TIMEOUT;
            onlineTlsVerify = mbedtls_ssl_get_verify_result(&tlsContext);
            return false;
        }
        svcSleepThread(1000000);
    }
    onlineTlsResult = 0;
    onlineProtocolStage = 4;
    onlineTlsVerify = mbedtls_ssl_get_verify_result(&tlsContext);
    if (onlineTlsVerify != 0) return false;
    tlsActive = true;

    onlineProtocolStage = 5;
    unsigned char nonce[16];
    unsigned char key[32] = {};
    size_t keyLength = 0;
    if (mbedtls_ctr_drbg_random(&tlsRandom, nonce, sizeof(nonce)) ||
        mbedtls_base64_encode(key, sizeof(key) - 1, &keyLength, nonce, sizeof(nonce))) return false;
    key[keyLength] = 0;
    char request[640];
    int requestLength = snprintf(request, sizeof(request),
        "GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\nUser-Agent: Emerald-Online-3DS/" APP_VERSION "\r\n\r\n",
        webSocketPath, serverHost, key);
    if (requestLength < 1 || requestLength >= (int) sizeof(request) ||
        onlineWriteBytes((const unsigned char*) request, requestLength) != requestLength) return false;

    char acceptSource[96];
    snprintf(acceptSource, sizeof(acceptSource), "%s258EAFA5-E914-47DA-95CA-C5AB0DC85B11", key);
    unsigned char digest[20];
    unsigned char accept[40] = {};
    size_t acceptLength = 0;
    if (mbedtls_sha1_ret((const unsigned char*) acceptSource, strlen(acceptSource), digest) ||
        mbedtls_base64_encode(accept, sizeof(accept) - 1, &acceptLength, digest, sizeof(digest))) return false;
    accept[acceptLength] = 0;
    onlineProtocolStage = 6;
    char response[2048] = {};
    size_t responseLength = 0;
    deadline = osGetTime() + 8000;
    while (!strstr(response, "\r\n\r\n") && responseLength < sizeof(response) - 1) {
        result = mbedtls_ssl_read(&tlsContext, (unsigned char*) response + responseLength, sizeof(response) - 1 - responseLength);
        if (result == MBEDTLS_ERR_SSL_WANT_READ || result == MBEDTLS_ERR_SSL_WANT_WRITE) {
            if (osGetTime() >= deadline) return false;
            svcSleepThread(1000000);
            continue;
        }
        if (result <= 0) return false;
        responseLength += (size_t) result;
        response[responseLength] = 0;
    }
    if (strncmp(response, "HTTP/1.1 101", 12)) return false;
    onlineProtocolStage = 7;
    if (!webSocketHeaderEquals(response, "Sec-WebSocket-Accept", (const char*) accept)) return false;
    onlineProtocolStage = 0;
    return true;
}

static bool validLinkRoom(const char* value) {
    if (!value || strlen(value) != 9 || value[4] != '-') return false;
    for (unsigned index = 0; index < 9; ++index) {
        if (index == 4) continue;
        const char character = value[index];
        if (!((character >= 'A' && character <= 'Z' && character != 'I' && character != 'O') ||
              (character >= '2' && character <= '9'))) return false;
    }
    return true;
}

static void loadConfig(void) {
    FILE* file = fopen(CONFIG_PATH, "r");
    if (!file) return;
    bool transportConfigured = false;
    char line[320];
    while (fgets(line, sizeof(line), file)) {
        line[strcspn(line, "\r\n")] = 0;
        char* equals = strchr(line, '=');
        if (!equals) continue;
        *equals++ = 0;
        if (!strcmp(line, "server") && strlen(equals) < sizeof(serverHost)) strcpy(serverHost, equals);
        else if (!strcmp(line, "port")) serverPort = strtoul(equals, NULL, 10);
        else if (!strcmp(line, "transport")) {
            secureWebSocket = strcmp(equals, "tcp") != 0;
            transportConfigured = true;
        }
        else if (!strcmp(line, "path") && equals[0] == '/' && strlen(equals) < sizeof(webSocketPath)) strcpy(webSocketPath, equals);
        else if (!strcmp(line, "name") && strlen(equals) < sizeof(trainerName)) strcpy(trainerName, equals);
        else if (!strcmp(line, "page")) bottomPage = !strcmp(equals, "users") ? PAGE_USERS : !strcmp(equals, "chat") ? PAGE_CHAT : !strcmp(equals, "party") ? PAGE_PARTY : !strcmp(equals, "bag") ? PAGE_BAG : !strcmp(equals, "map") ? PAGE_MAP : !strcmp(equals, "stats") ? PAGE_STATS : !strcmp(equals, "teleport") ? PAGE_TELEPORT : !strcmp(equals, "update") ? PAGE_UPDATE : PAGE_ONLINE;
        else if (!strcmp(line, "dynarec")) dynarecEnabled = strcmp(equals, "disabled") != 0;
        else if (!strcmp(line, "link_room") && validLinkRoom(equals)) {
            strcpy(linkRoom, equals);
            linkConfigured = true;
            snprintf(linkStatus, sizeof(linkStatus), "LINK %s CONFIGURED", linkRoom);
        }
    }
    fclose(file);
    // Old/custom files without an explicit transport use TLS only on 443.
    // Release packages always overwrite online.cfg with the public WSS route.
    if (!transportConfigured) secureWebSocket = serverPort == 443;
}

static bool isHexString(const char* value, size_t length) {
    if (strlen(value) != length) return false;
    for (size_t i = 0; i < length; ++i)
        if (!((value[i] >= '0' && value[i] <= '9') || (value[i] >= 'a' && value[i] <= 'f') || (value[i] >= 'A' && value[i] <= 'F'))) return false;
    return true;
}

static void loadIdentity(void) {
    FILE* file = fopen(IDENTITY_PATH, "r");
    if (!file) return;
    char line[160];
    while (fgets(line, sizeof(line), file)) {
        line[strcspn(line, "\r\n")] = 0;
        char* equals = strchr(line, '=');
        if (!equals) continue;
        *equals++ = 0;
        if (!strcmp(line, "id") && strlen(equals) == 36) strcpy(identityId, equals);
        else if (!strcmp(line, "token") && isHexString(equals, 64)) strcpy(identityToken, equals);
        else if (!strcmp(line, "credential") && strlen(equals) == 36) strcpy(credentialId, equals);
        else if (!strcmp(line, "fingerprint") && strlen(equals) == 10) strcpy(identityFingerprint, equals);
    }
    fclose(file);
    if (!identityId[0] || !identityToken[0] || !credentialId[0]) {
        identityId[0] = identityToken[0] = credentialId[0] = identityFingerprint[0] = 0;
    }
}

static bool saveIdentity(void) {
    if (!identityId[0] || !identityToken[0] || !credentialId[0]) return false;
    FILE* file = fopen(IDENTITY_TEMP_PATH, "w");
    if (!file) return false;
    bool ok = fprintf(file, "id=%s\ntoken=%s\ncredential=%s\nfingerprint=%s\n", identityId, identityToken, credentialId, identityFingerprint) > 0;
    if (fflush(file) || fsync(fileno(file))) ok = false;
    if (fclose(file)) ok = false;
    if (!ok || rename(IDENTITY_TEMP_PATH, IDENTITY_PATH)) { remove(IDENTITY_TEMP_PATH); return false; }
    return true;
}

static void loadStatsConfig(void) {
    FILE* file = fopen(STATS_CONFIG_PATH, "r");
    if (!file) return;
    char line[80];
    while (fgets(line, sizeof(line), file)) {
        line[strcspn(line, "\r\n")] = 0;
        char* equals = strchr(line, '='); if (!equals) continue; *equals++ = 0;
        bool value = !strcmp(equals, "1");
        if (!strcmp(line, "enabled")) statsEnabled = value;
        else if (!strcmp(line, "pokedex_seen")) statsSeenEnabled = value;
        else if (!strcmp(line, "pokedex_caught")) statsCaughtEnabled = value;
        else if (!strcmp(line, "badges")) statsBadgesEnabled = value;
        else if (!strcmp(line, "frontier_streaks")) statsFrontierEnabled = value;
    }
    fclose(file);
    if (!statsEnabled) statsSeenEnabled = statsCaughtEnabled = statsBadgesEnabled = statsFrontierEnabled = false;
}

static bool saveStatsConfig(void) {
    FILE* file = fopen(STATS_CONFIG_TEMP_PATH, "w"); if (!file) return false;
    bool ok = fprintf(file, "enabled=%d\npokedex_seen=%d\npokedex_caught=%d\nbadges=%d\nfrontier_streaks=%d\n",
        statsEnabled, statsSeenEnabled, statsCaughtEnabled, statsBadgesEnabled, statsFrontierEnabled) > 0;
    if (fflush(file) || fsync(fileno(file))) ok = false;
    if (fclose(file)) ok = false;
    if (!ok || rename(STATS_CONFIG_TEMP_PATH, STATS_CONFIG_PATH)) { remove(STATS_CONFIG_TEMP_PATH); return false; }
    return true;
}

static void onlineDisconnect(void) {
    if (linkStarted && coreNetpacketInterface && coreNetpacketInterface->stop) coreNetpacketInterface->stop();
    linkStarted = false;
    linkJoined = false;
    if (linkConfigured) strcpy(linkStatus, "LINK RECONNECTING");
    if (tlsActive) mbedtls_ssl_close_notify(&tlsContext);
    tlsActive = false;
    if (onlineSocket >= 0) close(onlineSocket);
    onlineSocket = -1;
    onlineMode = ONLINE_OFFLINE;
    remoteCount = 0;
    onlineUserCount = 0;
    onlineUserPage = 0;
    onlineUserExpectedPage = onlineUserExpectedPages = 0;
    receiveLength = 0;
    webSocketLength = 0;
    onlineAuthenticated = false;
    teleportLocationsRequested = false;
    memset(&lastSentPresence, 0, sizeof(lastSentPresence));
    if (onlineEnabled) nextReconnect = osGetTime() + 3000;
}

static void onlineFail(int error) {
    onlineLastError = error ? error : EIO;
    onlineDisconnect();
}

static bool onlineSend(const char* message) {
    size_t size = strlen(message);
    bool sent = secureWebSocket
        ? webSocketWriteFrame(0x1, (const unsigned char*) message, size)
        : onlineWriteBytes((const unsigned char*) message, size) == (int) size;
    if (sent) return true;
    onlineFail(EIO);
    return false;
}

static bool sendStatsConsent(bool deleteHistory) {
    if (!onlineAuthenticated || !identityId[0]) return false;
    char packet[320];
    snprintf(packet, sizeof(packet),
        "{\"type\":\"stats_consent\",\"enabled\":%s,\"deleteHistory\":%s,\"fields\":{\"pokedex_seen\":%s,\"pokedex_caught\":%s,\"badges\":%s,\"frontier_streaks\":%s}}\n",
        statsEnabled ? "true" : "false", deleteHistory ? "true" : "false",
        statsSeenEnabled ? "true" : "false", statsCaughtEnabled ? "true" : "false",
        statsBadgesEnabled ? "true" : "false", statsFrontierEnabled ? "true" : "false");
    return onlineSend(packet);
}

static bool appendPacket(char* packet, size_t capacity, size_t* length, const char* format, ...) {
    if (*length >= capacity) return false;
    va_list args; va_start(args, format);
    int written = vsnprintf(packet + *length, capacity - *length, format, args);
    va_end(args);
    if (written < 0 || (size_t) written >= capacity - *length) return false;
    *length += (size_t) written;
    return true;
}

static bool sendStatsSnapshot(void) {
    if (!onlineAuthenticated || !statsEnabled || !saveStats.valid) return false;
    char packet[3072]; size_t length = 0; bool comma = false;
    if (!appendPacket(packet, sizeof(packet), &length, "{\"type\":\"stats_snapshot\",\"release\":\"" APP_VERSION "\",\"values\":{")) return false;
    if (statsSeenEnabled) { if (!appendPacket(packet,sizeof(packet),&length,"\"pokedex_seen\":%u",saveStats.seen)) return false; comma=true; }
    if (statsCaughtEnabled) { if (!appendPacket(packet,sizeof(packet),&length,"%s\"pokedex_caught\":%u",comma?",":"",saveStats.caught)) return false; comma=true; }
    if (statsBadgesEnabled) { if (!appendPacket(packet,sizeof(packet),&length,"%s\"badges\":%u",comma?",":"",saveStats.badges)) return false; comma=true; }
    if (statsFrontierEnabled) {
        if (!appendPacket(packet,sizeof(packet),&length,"%s\"frontier_streaks\":[",comma?",":"")) return false;
        static const char* facilities[22] = {"tower","tower","tower","tower","dome","dome","dome","dome","palace","palace","palace","palace","factory","factory","factory","factory","arena","arena","pike","pike","pyramid","pyramid"};
        static const char* modes[22] = {"singles","singles","doubles","doubles","singles","singles","doubles","doubles","singles","singles","doubles","doubles","singles","singles","doubles","doubles","singles","singles","singles","singles","singles","singles"};
        for (unsigned index=0;index<22;++index) if (!appendPacket(packet,sizeof(packet),&length,"%s{\"facility\":\"%s\",\"mode\":\"%s\",\"level\":\"%s\",\"streak\":%u}",index?",":"",facilities[index],modes[index],(index&1)?"open":"50",saveStats.frontier[index])) return false;
        if (!appendPacket(packet,sizeof(packet),&length,"]")) return false;
        comma=true;
    }
    if (!comma || !appendPacket(packet,sizeof(packet),&length,"}}\n")) return false;
    return onlineSend(packet);
}

static void syncStatsAfterAuthentication(void) {
    onlineAuthenticated = true;
    if (!teleportLocationsRequested) {
        onlineSend("{\"type\":\"teleport_locations\"}\n");
        teleportLocationsRequested = true;
    }
    if (linkConfigured && !linkJoined) {
        char packet[160];
        snprintf(packet, sizeof(packet), "{\"type\":\"link_spike_join\",\"room\":\"%s\",\"core\":\"gpSP v1.0\"}\n", linkRoom);
        if (onlineSend(packet)) {
            linkJoined = true;
            strcpy(linkStatus, "LINK JOIN SENT");
        }
    }
    if (!statsEnabled) return;
    if (sendStatsConsent(false) && sendStatsSnapshot()) {
        strcpy(statsStatus, "SYNC SENT - COMMUNITY-SUBMITTED");
        statsStatusUntil = osGetTime() + 5000;
    }
    nextStatsUpload = osGetTime() + 60000;
}

static void onlineConnected(void) {
    if (secureWebSocket && !startSecureWebSocket()) { debugNetworkFailure(); return onlineFail(EPROTO); }
    onlineMode = ONLINE_ACTIVE;
    onlineAuthenticated = false;
    onlineLastError = 0;
    lastPing = osGetTime();
    char hello[320];
    if (identityId[0] && identityToken[0])
        snprintf(hello, sizeof(hello), "{\"type\":\"hello\",\"version\":2,\"name\":\"%s\",\"identity\":\"%s\",\"token\":\"%s\",\"avatar\":\"%s\"}\n", trainerName, identityId, identityToken, trainerIsGirl ? "girl" : "boy");
    else
        snprintf(hello, sizeof(hello), "{\"type\":\"enroll\",\"version\":2,\"name\":\"%s\",\"avatar\":\"%s\",\"recovery\":true}\n", trainerName, trainerIsGirl ? "girl" : "boy");
    onlineSend(hello);
}

static void onlineConnect(void) {
    if (!onlineEnabled || onlineMode != ONLINE_OFFLINE) return;
    debugStage("connect-begin");
    nextReconnect = 0;
    onlineSocket = socket(AF_INET, SOCK_STREAM, 0);
    if (onlineSocket < 0) return onlineFail(errno);
    debugStage("connect-socket-ready");
    fcntl(onlineSocket, F_SETFL, fcntl(onlineSocket, F_GETFL, 0) | O_NONBLOCK);
    sockaddr_in address = {};
    address.sin_family = AF_INET;
    address.sin_port = htons(serverPort);
    uint64_t now = osGetTime();
    if (!serverAddressResolvedAt || now - serverAddressResolvedAt >= 60000) {
        if (inet_pton(AF_INET, serverHost, &serverAddress) != 1) {
            addrinfo hints = {};
            hints.ai_family = AF_INET;
            hints.ai_socktype = SOCK_STREAM;
            addrinfo* resolved = NULL;
            if (getaddrinfo(serverHost, NULL, &hints, &resolved) || !resolved) return onlineFail(EHOSTUNREACH);
            serverAddress = ((sockaddr_in*) resolved->ai_addr)->sin_addr;
            freeaddrinfo(resolved);
        }
        serverAddressResolvedAt = now;
        debugStage("connect-address-resolved");
    }
    address.sin_addr = serverAddress;
    debugStage("connect-call");
    int result = connect(onlineSocket, (sockaddr*) &address, sizeof(address));
    if (!result) { debugStage("connect-immediate"); onlineConnected(); }
    else if (errno == EINPROGRESS || errno == EWOULDBLOCK) {
        debugStage("connect-in-progress");
        onlineMode = ONLINE_CONNECTING;
        connectStarted = osGetTime();
    } else { debugStage("connect-failed"); onlineFail(errno); }
}

static const char* skipJsonSpace(const char* at, const char* end) {
    while (at < end && (*at == ' ' || *at == '\t' || *at == '\r' || *at == '\n')) ++at;
    return at;
}

// Decode a bounded JSON string, including escapes, without reading past the
// current protocol line/object. Server fields are ASCII, so non-ASCII \u
// escapes are represented as '?' rather than being copied as ambiguous bytes.
static bool parseJsonString(const char** cursor, const char* end, char* output, size_t size) {
    const char* at = *cursor;
    if (at >= end || *at++ != '"' || !size) return false;
    size_t written = 0;
    while (at < end) {
        unsigned char value = (unsigned char) *at++;
        if (value == '"') { output[written] = 0; *cursor = at; return true; }
        if (value < 0x20) return false;
        if (value == '\\') {
            if (at >= end) return false;
            char escape = *at++;
            if (escape == '"' || escape == '\\' || escape == '/') value = (unsigned char) escape;
            else if (escape == 'b') value = '\b';
            else if (escape == 'f') value = '\f';
            else if (escape == 'n') value = '\n';
            else if (escape == 'r') value = '\r';
            else if (escape == 't') value = '\t';
            else if (escape == 'u') {
                if (end - at < 4) return false;
                unsigned codepoint = 0;
                for (int i = 0; i < 4; ++i) {
                    char digit = *at++;
                    codepoint <<= 4;
                    if (digit >= '0' && digit <= '9') codepoint |= digit - '0';
                    else if (digit >= 'a' && digit <= 'f') codepoint |= digit - 'a' + 10;
                    else if (digit >= 'A' && digit <= 'F') codepoint |= digit - 'A' + 10;
                    else return false;
                }
                value = codepoint >= 0x20 && codepoint <= 0x7e ? (unsigned char) codepoint : '?';
            } else return false;
        }
        if (written + 1 >= size) return false;
        output[written++] = (char) value;
    }
    return false;
}

static const char* findJsonValue(const char* json, const char* end, const char* key) {
    const char* at = json;
    while (at < end) {
        if (*at != '"') { ++at; continue; }
        // This scratch value is used while walking both keys and preceding
        // string values. It must hold the protocol's longest allowed string
        // (80-byte chat plus terminator) even when that value is not our key.
        char candidate[96];
        const char* after = at;
        if (!parseJsonString(&after, end, candidate, sizeof(candidate))) return NULL;
        const char* colon = skipJsonSpace(after, end);
        if (colon < end && *colon == ':' && !strcmp(candidate, key)) return skipJsonSpace(colon + 1, end);
        at = after;
    }
    return NULL;
}

static int jsonIntBounded(const char* json, const char* end, const char* key, int fallback) {
    const char* value = findJsonValue(json, end, key);
    if (!value || value >= end) return fallback;
    char* parsedEnd = NULL;
    long parsed = strtol(value, &parsedEnd, 10);
    if (parsedEnd == value || parsedEnd > end) return fallback;
    const char* delimiter = skipJsonSpace(parsedEnd, end);
    if (delimiter < end && *delimiter != ',' && *delimiter != '}' && *delimiter != ']') return fallback;
    return (int) parsed;
}

static int jsonInt(const char* line, const char* key, int fallback) {
    return jsonIntBounded(line, line + strlen(line), key, fallback);
}

static bool jsonStringBounded(const char* json, const char* end, const char* key, char* output, size_t size) {
    const char* value = findJsonValue(json, end, key);
    return value && parseJsonString(&value, end, output, size);
}

static bool jsonString(const char* line, const char* key, char* output, size_t size) {
    return jsonStringBounded(line, line + strlen(line), key, output, size);
}

static bool jsonTypeIs(const char* line, const char* expected) {
    char type[32] = {};
    return jsonString(line, "type", type, sizeof(type)) && !strcmp(type, expected);
}

static const char* findJsonObjectEnd(const char* at, const char* end) {
    if (at >= end || *at != '{') return NULL;
    int depth = 0;
    bool inString = false, escaped = false;
    for (; at < end; ++at) {
        char value = *at;
        if (inString) {
            if (escaped) escaped = false;
            else if (value == '\\') escaped = true;
            else if (value == '"') inString = false;
        } else if (value == '"') inString = true;
        else if (value == '{') ++depth;
        else if (value == '}' && --depth == 0) return at + 1;
    }
    return NULL;
}

static int hexNibble(char value) {
    if (value >= '0' && value <= '9') return value - '0';
    if (value >= 'a' && value <= 'f') return value - 'a' + 10;
    if (value >= 'A' && value <= 'F') return value - 'A' + 10;
    return -1;
}

static size_t decodeLinkPacket(const char* encoded, uint8_t* output, size_t capacity) {
    const size_t length = strlen(encoded);
    if (!length || (length & 1) || length / 2 > capacity) return 0;
    for (size_t index = 0; index < length / 2; ++index) {
        int high = hexNibble(encoded[index * 2]), low = hexNibble(encoded[index * 2 + 1]);
        if (high < 0 || low < 0) return 0;
        output[index] = (uint8_t) ((high << 4) | low);
    }
    return length / 2;
}

static void stopLink(const char* status) {
    if (linkStarted && coreNetpacketInterface && coreNetpacketInterface->stop) coreNetpacketInterface->stop();
    linkStarted = false;
    if (status) snprintf(linkStatus, sizeof(linkStatus), "%s", status);
}

static void parseOnlineLine(char* line) {
    if (jsonTypeIs(line, "enrolled") || jsonTypeIs(line, "identity_recovered")) {
        char id[37] = {}, token[65] = {}, credential[37] = {}, fingerprint[11] = {}, recovery[25] = {}, role[10] = {};
        if (!jsonString(line, "id", id, sizeof(id)) || !jsonString(line, "token", token, sizeof(token)) ||
            !jsonString(line, "credentialId", credential, sizeof(credential)) || !isHexString(token, 64)) return;
        strcpy(identityId, id);
        strcpy(identityToken, token);
        strcpy(credentialId, credential);
        if (jsonString(line, "fingerprint", fingerprint, sizeof(fingerprint))) strcpy(identityFingerprint, fingerprint);
        if (jsonString(line, "recoveryCode", recovery, sizeof(recovery))) strcpy(recoveryCode, recovery);
        if (jsonString(line, "role", role, sizeof(role))) snprintf(trainerRole, sizeof(trainerRole), "%s", role);
        else strcpy(trainerRole, "player");
        if (!saveIdentity()) onlineLastError = EIO;
        syncStatsAfterAuthentication();
        return;
    }
    if (jsonTypeIs(line, "welcome")) {
        char fingerprint[11] = {}, role[10] = {};
        if (jsonString(line, "fingerprint", fingerprint, sizeof(fingerprint))) strcpy(identityFingerprint, fingerprint);
        if (jsonString(line, "role", role, sizeof(role))) snprintf(trainerRole, sizeof(trainerRole), "%s", role);
        else strcpy(trainerRole, "player");
        syncStatsAfterAuthentication();
        return;
    }
    if (jsonTypeIs(line, "teleport_locations")) {
        teleportDestinationCount = 0;
        teleportCustomVisible = false;
        teleportSelectedIndex = -1;
        const char* lineEnd = line + strlen(line);
        const char* dests = findJsonValue(line, lineEnd, "destinations");
        if (dests && dests < lineEnd && *dests == '[') ++dests;
        while (dests && teleportDestinationCount < 64) {
            dests = skipJsonSpace(dests, lineEnd);
            if (dests >= lineEnd || *dests == ']') break;
            if (*dests != '{') return;
            const char* objectEnd = findJsonObjectEnd(dests, lineEnd);
            if (!objectEnd) return;
            TeleportDestination* dest = &teleportDestinations[teleportDestinationCount];
            if (!jsonStringBounded(dests, objectEnd, "id", dest->id, sizeof(dest->id)) ||
                !jsonStringBounded(dests, objectEnd, "name", dest->name, sizeof(dest->name))) break;
            jsonStringBounded(dests, objectEnd, "kind", dest->kind, sizeof(dest->kind));
            ++teleportDestinationCount;
            dests = skipJsonSpace(objectEnd, lineEnd);
            if (dests < lineEnd && *dests == ',') ++dests;
        }
        char visible[8] = {};
        if (jsonString(line, "customVisible", visible, sizeof(visible)) || jsonString(line, "custom_visible", visible, sizeof(visible)))
            teleportCustomVisible = !strcmp(visible, "true");
        return;
    }
    if (jsonTypeIs(line, "teleport_result")) {
        if (!jsonInt(line, "ok", 0)) {
            char code[32] = {};
            jsonString(line, "code", code, sizeof(code));
            snprintf(teleportStatus, sizeof(teleportStatus), "WARP FAILED: %.30s", code);
            teleportStatusUntil = osGetTime() + 5000;
            return;
        }
        int mapGroup = jsonInt(line, "map_group", -1);
        int mapNum = jsonInt(line, "map_num", -1);
        int x = jsonInt(line, "x", -1);
        int y = jsonInt(line, "y", -1);
        char facing[8] = {};
        jsonString(line, "facing", facing, sizeof(facing));
        uint8_t facingValue = !strcmp(facing, "up") ? 2 : !strcmp(facing, "left") ? 3 : !strcmp(facing, "right") ? 4 : 1;
        if (mapGroup < 0 || mapGroup > 255 || mapNum < 0 || mapNum > 255 || x < 0 || x > 4095 || y < 0 || y > 4095) {
            snprintf(teleportStatus, sizeof(teleportStatus), "WARP FAILED: BAD COORDS");
            teleportStatusUntil = osGetTime() + 5000;
            return;
        }
        applyTeleport((uint8_t)mapGroup, (uint8_t)mapNum, (int16_t)x, (int16_t)y, facingValue);
        snprintf(teleportStatus, sizeof(teleportStatus), "WARPED TO %d,%d", x, y);
        teleportStatusUntil = osGetTime() + 5000;
        return;
    }
    if (jsonTypeIs(line, "stats_consent_saved")) {
        strcpy(statsStatus, "CONSENT SAVED ON SERVER"); statsStatusUntil = osGetTime() + 5000; return;
    }
    if (jsonTypeIs(line, "stats_snapshot_saved")) {
        int review = jsonInt(line, "underReview", 0);
        strcpy(statsStatus, review ? "SENT - SOME VALUES UNDER REVIEW" : "SCORES SYNCED");
        statsStatusUntil = osGetTime() + 5000; return;
    }
    if (jsonTypeIs(line, "browser_pairing_approved")) {
        strcpy(browserPairingStatus, "BROWSER PAIRED");
        browserPairingStatusUntil = osGetTime() + 5000;
        return;
    }
    if (jsonTypeIs(line, "link_waiting")) {
        stopLink(NULL);
        snprintf(linkStatus, sizeof(linkStatus), "LINK %s WAITING", linkRoom);
        return;
    }
    if (jsonTypeIs(line, "link_started")) {
        int clientId = jsonInt(line, "clientId", -1), peerId = jsonInt(line, "peerId", -1);
        if (clientId < 0 || clientId > 1 || peerId < 0 || peerId > 1 || !coreNetpacketInterface ||
            !coreNetpacketInterface->start || !backupSaveForLink()) {
            strcpy(linkStatus, "LINK BLOCKED - SAVE BACKUP FAILED");
            onlineSend("{\"type\":\"link_leave\"}\n");
            linkJoined = false;
            return;
        }
        linkClientId = (unsigned) clientId;
        linkPeerId = (unsigned) peerId;
        linkPacketsSent = linkPacketsReceived = 0;
        coreNetpacketInterface->start((uint16_t) linkClientId, frontendNetpacketSend, frontendNetpacketPollReceive);
        if (linkClientId == 0 && coreNetpacketInterface->connected && !coreNetpacketInterface->connected((uint16_t) linkPeerId)) {
            if (coreNetpacketInterface->stop) coreNetpacketInterface->stop();
            onlineSend("{\"type\":\"link_leave\"}\n");
            linkJoined = false;
            strcpy(linkStatus, "LINK BLOCKED BY CORE");
            return;
        }
        linkStarted = true;
        snprintf(linkStatus, sizeof(linkStatus), "LINK %s ACTIVE - BACKUP OK", linkRoom);
        debugStage("link-started-backup-complete");
        return;
    }
    if (jsonTypeIs(line, "link_packet")) {
        char encoded[1025] = {};
        uint8_t packet[512];
        int from = jsonInt(line, "from", -1);
        if (!linkStarted || from < 0 || from > 3 || !jsonString(line, "data", encoded, sizeof(encoded))) return;
        size_t size = decodeLinkPacket(encoded, packet, sizeof(packet));
        if (!size) return;
        coreNetpacketInterface->receive(packet, size, (uint16_t) from);
        ++linkPacketsReceived;
        return;
    }
    if (jsonTypeIs(line, "link_peer_disconnected")) {
        int clientId = jsonInt(line, "clientId", -1);
        if (linkStarted && linkClientId == 0 && clientId >= 0 && coreNetpacketInterface->disconnected)
            coreNetpacketInterface->disconnected((uint16_t) clientId);
        stopLink("LINK PEER DISCONNECTED");
        return;
    }
    if (jsonTypeIs(line, "link_ended") || jsonTypeIs(line, "link_left")) {
        stopLink("LINK SESSION ENDED");
        linkJoined = false;
        return;
    }
    if (jsonTypeIs(line, "error")) {
        char code[40] = {};
        if (jsonString(line, "code", code, sizeof(code)) && strstr(code, "pairing")) {
            strcpy(browserPairingStatus, "PAIRING CODE EXPIRED");
            browserPairingStatusUntil = osGetTime() + 5000;
        }
        if (strstr(code, "stats")) {
            snprintf(statsStatus, sizeof(statsStatus), "SERVER: %.34s", code);
            statsStatusUntil = osGetTime() + 6000;
        }
        if (strstr(code, "link")) {
            snprintf(linkStatus, sizeof(linkStatus), "SERVER: %.34s", code);
            if (strcmp(code, "link_rate_limited")) { stopLink(NULL); linkJoined = false; }
        }
        return;
    }
    if (jsonTypeIs(line, "online_users")) {
        const int page = jsonInt(line, "page", -1), pages = jsonInt(line, "pages", -1);
        if (page < 0 || pages < 1 || pages > 4 || page >= pages) return;
        if (page == 0) {
            onlineUserCount = 0;
            onlineUserExpectedPage = 0;
            onlineUserExpectedPages = (unsigned) pages;
        }
        if ((unsigned) page != onlineUserExpectedPage || (unsigned) pages != onlineUserExpectedPages) return;
        const char* lineEnd = line + strlen(line);
        const char* user = findJsonValue(line, lineEnd, "users");
        if (user && user < lineEnd && *user == '[') ++user;
        while (user && onlineUserCount < 64) {
            user = skipJsonSpace(user, lineEnd);
            if (user >= lineEnd || *user == ']') break;
            if (*user != '{') return;
            const char* objectEnd = findJsonObjectEnd(user, lineEnd);
            if (!objectEnd) return;
            OnlineUser candidate = {};
            if (!jsonStringBounded(user, objectEnd, "id", candidate.id, sizeof(candidate.id)) ||
                !jsonStringBounded(user, objectEnd, "name", candidate.name, sizeof(candidate.name))) return;
            jsonStringBounded(user, objectEnd, "map", candidate.map, sizeof(candidate.map));
            candidate.x = jsonIntBounded(user, objectEnd, "x", -1);
            candidate.y = jsonIntBounded(user, objectEnd, "y", -1);
            if (!jsonStringBounded(user, objectEnd, "role", candidate.role, sizeof(candidate.role))) strcpy(candidate.role, "player");
            candidate.positioned = candidate.map[0] && candidate.x >= 0 && candidate.y >= 0;
            onlineUsers[onlineUserCount++] = candidate;
            user = skipJsonSpace(objectEnd, lineEnd);
            if (user < lineEnd && *user == ',') ++user;
        }
        ++onlineUserExpectedPage;
        const unsigned pageCount = onlineUserCount ? (onlineUserCount + 5) / 6 : 1;
        if (onlineUserPage >= pageCount) onlineUserPage = pageCount - 1;
        return;
    }
    if (jsonTypeIs(line, "chat")) {
        char name[13] = {}, text[81] = {}, map[33] = {}, sentAt[32] = {}, scope[8] = {};
        if (!jsonString(line, "name", name, sizeof(name)) || !jsonString(line, "text", text, sizeof(text))) return;
        jsonString(line, "map", map, sizeof(map));
        jsonString(line, "sentAt", sentAt, sizeof(sentAt));
        jsonString(line, "scope", scope, sizeof(scope));
        strcpy(lastChatName, name);
        strcpy(lastChatText, text);
        if (chatHistoryCount == 24) {
            memmove(chatHistory, chatHistory + 1, sizeof(chatHistory) - sizeof(chatHistory[0]));
            --chatHistoryCount;
        }
        ChatMessage* message = &chatHistory[chatHistoryCount++];
        strcpy(message->name, name);
        strcpy(message->map, map);
        strcpy(message->text, text);
        message->global = !strcmp(scope, "global");
        if (strlen(sentAt) >= 16 && sentAt[10] == 'T' && sentAt[13] == ':')
            snprintf(message->time, sizeof(message->time), "%c%c:%c%cZ", sentAt[11], sentAt[12], sentAt[14], sentAt[15]);
        else strcpy(message->time, "NOW");
        chatPage = ~0u;
        return;
    }
    if (jsonTypeIs(line, "leave")) {
        char id[37] = {};
        if (!jsonString(line, "id", id, sizeof(id))) return;
        for (int i = 0; i < remoteCount; ++i) if (!strcmp(remoteTrainers[i].id, id)) remoteTrainers[i] = remoteTrainers[--remoteCount];
        return;
    }
    if (jsonTypeIs(line, "snapshot")) {
        RemoteTrainer updated[8] = {};
        int updatedCount = 0;
        const char* lineEnd = line + strlen(line);
        const char* player = findJsonValue(line, lineEnd, "players");
        if (player && player < lineEnd && *player == '[') ++player;
        while (player && updatedCount < 8) {
            player = skipJsonSpace(player, lineEnd);
            if (player >= lineEnd || *player == ']') break;
            if (*player != '{') { player = NULL; break; }
            const char* objectEnd = findJsonObjectEnd(player, lineEnd);
            if (!objectEnd) break;
            RemoteTrainer* trainer = &updated[updatedCount];
            if (!jsonStringBounded(player, objectEnd, "id", trainer->id, sizeof(trainer->id)) ||
                !jsonStringBounded(player, objectEnd, "name", trainer->name, sizeof(trainer->name))) break;
            trainer->x = jsonIntBounded(player, objectEnd, "x", 0);
            trainer->y = jsonIntBounded(player, objectEnd, "y", 0);
            char direction[8] = {};
            jsonStringBounded(player, objectEnd, "facing", direction, sizeof(direction));
            trainer->facing = !strcmp(direction, "up") ? 2 : !strcmp(direction, "left") ? 3 : !strcmp(direction, "right") ? 4 : 1;
            char avatar[8] = {};
            if (jsonStringBounded(player, objectEnd, "avatar", avatar, sizeof(avatar))) trainer->isGirl = !strcmp(avatar, "girl");
            for (int old = 0; old < remoteCount; ++old) {
                if (!strcmp(remoteTrainers[old].id, trainer->id)) {
                    trainer->emote = remoteTrainers[old].emote;
                    trainer->emoteUntil = remoteTrainers[old].emoteUntil;
                    break;
                }
            }
            ++updatedCount;
            player = objectEnd;
            player = skipJsonSpace(player, lineEnd);
            if (player < lineEnd && *player == ',') ++player;
        }
        memcpy(remoteTrainers, updated, sizeof(updated));
        remoteCount = updatedCount;
        return;
    }
    if (!jsonTypeIs(line, "presence") && !jsonTypeIs(line, "state") && !jsonTypeIs(line, "emote")) return;
    char id[37] = {}, name[13] = {}, facing[8] = {};
    if (!jsonString(line, "id", id, sizeof(id))) return;
    int index = -1;
    for (int i = 0; i < remoteCount; ++i) if (!strcmp(remoteTrainers[i].id, id)) index = i;
    if (index < 0 && remoteCount < 8) index = remoteCount++;
    if (index < 0) return;
    RemoteTrainer* trainer = &remoteTrainers[index];
    strcpy(trainer->id, id);
    if (jsonString(line, "name", name, sizeof(name))) strcpy(trainer->name, name);
    trainer->x = jsonInt(line, "x", trainer->x);
    trainer->y = jsonInt(line, "y", trainer->y);
    if (jsonString(line, "facing", facing, sizeof(facing))) trainer->facing = !strcmp(facing, "up") ? 2 : !strcmp(facing, "left") ? 3 : !strcmp(facing, "right") ? 4 : 1;
    char avatar[8] = {};
    if (jsonString(line, "avatar", avatar, sizeof(avatar))) trainer->isGirl = !strcmp(avatar, "girl");
    char emote[12];
    if (jsonString(line, "emote", emote, sizeof(emote))) {
        trainer->emote = !strcmp(emote, "wave") ? 1 : !strcmp(emote, "battle") ? 2 : !strcmp(emote, "trade") ? 3 : 4;
        trainer->emoteUntil = osGetTime() + 1800;
    }
}

static bool consumeProtocolPayload(const unsigned char* payload, size_t size) {
    if (size > sizeof(receiveBuffer) - 1 - receiveLength) return false;
    memcpy(receiveBuffer + receiveLength, payload, size);
    receiveLength += size;
    receiveBuffer[receiveLength] = 0;
    char* newline;
    while ((newline = (char*) memchr(receiveBuffer, '\n', receiveLength))) {
        size_t lineSize = newline - receiveBuffer;
        *newline = 0;
        parseOnlineLine(receiveBuffer);
        memmove(receiveBuffer, newline + 1, receiveLength - lineSize - 1);
        receiveLength -= lineSize + 1;
    }
    return receiveLength < sizeof(receiveBuffer) - 1;
}

static bool processWebSocketFrames(void) {
    size_t consumed = 0;
    while (webSocketLength - consumed >= 2) {
        const unsigned char* frame = webSocketBuffer + consumed;
        if (frame[0] & 0x70) return false;
        uint8_t opcode = frame[0] & 0x0F;
        bool masked = (frame[1] & 0x80) != 0;
        uint64_t payloadLength = frame[1] & 0x7F;
        size_t headerLength = 2;
        if (payloadLength == 126) {
            if (webSocketLength - consumed < 4) break;
            payloadLength = ((uint64_t) frame[2] << 8) | frame[3];
            headerLength = 4;
        } else if (payloadLength == 127) {
            if (webSocketLength - consumed < 10) break;
            payloadLength = 0;
            for (unsigned index = 2; index < 10; ++index) payloadLength = (payloadLength << 8) | frame[index];
            headerLength = 10;
        }
        if (masked || payloadLength > 4096) return false;
        if (webSocketLength - consumed < headerLength + payloadLength) break;
        const unsigned char* payload = frame + headerLength;
        if (opcode == 0x8) return false;
        if (opcode == 0x9) {
            if (payloadLength > 125 || !webSocketWriteFrame(0xA, payload, (size_t) payloadLength)) return false;
        } else if (opcode == 0x0 || opcode == 0x1 || opcode == 0x2) {
            if (!consumeProtocolPayload(payload, (size_t) payloadLength)) return false;
        } else if (opcode != 0xA) return false;
        consumed += headerLength + (size_t) payloadLength;
    }
    if (consumed) {
        memmove(webSocketBuffer, webSocketBuffer + consumed, webSocketLength - consumed);
        webSocketLength -= consumed;
    }
    return webSocketLength < sizeof(webSocketBuffer);
}

static int onlineReadBytes(unsigned char* data, size_t size) {
    if (!tlsActive) {
        int result = (int) recv(onlineSocket, data, size, 0);
        if (result < 0 && (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR)) return -2;
        return result;
    }
    int result = mbedtls_ssl_read(&tlsContext, data, size);
    if (result == MBEDTLS_ERR_SSL_WANT_READ || result == MBEDTLS_ERR_SSL_WANT_WRITE) return -2;
    return result;
}

static bool receiveOnlineTraffic(void) {
    for (;;) {
        if (secureWebSocket) {
            if (!processWebSocketFrames()) return false;
            if (webSocketLength == sizeof(webSocketBuffer)) return false;
            int count = onlineReadBytes(webSocketBuffer + webSocketLength, sizeof(webSocketBuffer) - webSocketLength);
            if (count == -2) return true;
            if (count <= 0) return false;
            webSocketLength += (size_t) count;
        } else {
            unsigned char data[1024];
            int count = onlineReadBytes(data, sizeof(data));
            if (count == -2) return true;
            if (count <= 0) return false;
            if (!consumeProtocolPayload(data, (size_t) count)) return false;
        }
    }
}

static void onlineUpdate(void) {
    uint64_t now = osGetTime();
    if (onlineMode == ONLINE_OFFLINE && onlineEnabled && (!nextReconnect || now >= nextReconnect)) onlineConnect();
    if (onlineMode == ONLINE_CONNECTING) {
        // ctrulib's socket service can accept a nonblocking TCP connection
        // without subsequently marking it writable through select(). Polling
        // the peer state detects that completed connection reliably. Azahar
        // validates the guest sockaddr family before servicing getpeername(),
        // even though the call writes this output structure, so seed AF_INET.
        sockaddr_in peer = {};
        peer.sin_family = AF_INET;
        socklen_t peerSize = sizeof(peer);
        if (!getpeername(onlineSocket, (sockaddr*)&peer, &peerSize)) {
            debugStage("connect-peer-ready");
            int error = 0;
            socklen_t size = sizeof(error);
            if (!getsockopt(onlineSocket, SOL_SOCKET, SO_ERROR, &error, &size) && !error) onlineConnected();
            else onlineFail(error ? error : errno);
        } else if (errno != ENOTCONN && errno != EINPROGRESS && errno != EALREADY && errno != EAGAIN && errno != EWOULDBLOCK) {
            onlineFail(errno);
        } else if (now - connectStarted > 5000) onlineFail(ETIMEDOUT);
    }
    if (onlineMode != ONLINE_ACTIVE) return;
    if (now - lastPing >= 10000) {
        char ping[64];
        snprintf(ping, sizeof(ping), "{\"type\":\"ping\",\"at\":%llu}\n", (unsigned long long) now);
        if (!onlineSend(ping)) return;
        lastPing = now;
    }
    if (presence.valid && (!lastSentPresence.valid || memcmp(&presence, &lastSentPresence, sizeof(presence)))) {
        char state[192];
        snprintf(state, sizeof(state), "{\"type\":\"state\",\"seq\":%u,\"map\":\"%u-%u\",\"x\":%d,\"y\":%d,\"facing\":\"%s\",\"avatar\":\"%s\"}\n", ++onlineSequence, presence.mapGroup, presence.mapNum, presence.x, presence.y, facingName(presence.facing), trainerIsGirl ? "girl" : "boy");
        if (onlineSend(state)) lastSentPresence = presence;
    }
    if (onlineAuthenticated && statsEnabled && saveStats.valid && now >= nextStatsUpload) {
        sendStatsSnapshot();
        nextStatsUpload = now + 60000;
    }
    if (!receiveOnlineTraffic()) onlineFail(ECONNRESET);
}

static void onlineToggle(void) {
    onlineEnabled = !onlineEnabled;
    if (!onlineEnabled) onlineDisconnect(); else onlineConnect();
}

static void sendEmote(unsigned index) {
    static const char* names[] = {"wave", "battle", "trade", "gg"};
    if (onlineMode != ONLINE_ACTIVE || index > 3) return;
    char packet[64];
    snprintf(packet, sizeof(packet), "{\"type\":\"emote\",\"emote\":\"%s\"}\n", names[index]);
    onlineSend(packet);
}

static void openChat(void) {
    if (onlineMode != ONLINE_ACTIVE) return;
    char text[81] = {};
    if (!inputText(globalChat ? "Message all online trainers" : "Message trainers on this map", text, sizeof(text), 80) || !text[0]) return;
    for (char* p = text; *p; ++p) if (*p == '"' || *p == '\\' || (unsigned char)*p < 0x20) *p = ' ';
    char packet[144];
    snprintf(packet, sizeof(packet), "{\"type\":\"chat\",\"scope\":\"%s\",\"text\":\"%s\"}\n", globalChat ? "global" : "map", text);
    onlineSend(packet);
}

static bool canCreateCustomTeleport(void) {
    return !strcmp(trainerRole, "admin") || !strcmp(trainerRole, "moderator");
}

static void proposeCustomTeleport(void) {
    if (onlineMode != ONLINE_ACTIVE || !canCreateCustomTeleport()) return;
    char name[33] = {};
    if (!inputText("Custom destination name", name, sizeof(name), 32) || !name[0]) return;
    char coords[48] = {};
    if (!inputText("mapGroup-mapNum,x,y", coords, sizeof(coords), 31) || !coords[0]) return;
    unsigned mg = 0, mn = 0;
    int x = 0, y = 0;
    if (sscanf(coords, "%u-%u,%d,%d", &mg, &mn, &x, &y) != 4) {
        strcpy(teleportStatus, "INVALID FORMAT - USE map-map,x,y");
        teleportStatusUntil = osGetTime() + 5000;
        return;
    }
    if (mg > 255 || mn > 255 || x < 0 || x > 4096 || y < 0 || y > 4096) {
        strcpy(teleportStatus, "COORDINATES OUT OF RANGE");
        teleportStatusUntil = osGetTime() + 5000;
        return;
    }
    for (char* p = name; *p; ++p) if (*p == '"' || *p == '\\' || (unsigned char)*p < 0x20) *p = ' ';
    char packet[144];
    snprintf(packet, sizeof(packet), "{\"type\":\"teleport_custom_propose\",\"name\":\"%s\",\"map_group\":%u,\"map_num\":%u,\"x\":%d,\"y\":%d}\n", name, mg, mn, x, y);
    if (onlineSend(packet)) {
        strcpy(teleportStatus, "CUSTOM DEST SENT FOR APPROVAL");
    } else {
        strcpy(teleportStatus, "FAILED TO SEND CUSTOM DEST");
    }
    teleportStatusUntil = osGetTime() + 5000;
}

static void openBrowserPairing(void) {
    if (onlineMode != ONLINE_ACTIVE || !identityId[0]) return;
    SwkbdState keyboard;
    char entered[16] = {}, compact[9] = {}, code[10] = {};
    swkbdInit(&keyboard, SWKBD_TYPE_NORMAL, 1, 9);
    swkbdSetHintText(&keyboard, "Enter the 8-character browser code");
    if (swkbdInputText(&keyboard, entered, sizeof(entered)) != SWKBD_BUTTON_CONFIRM) return;
    size_t length = 0;
    for (const char* at = entered; *at && length < sizeof(compact) - 1; ++at) {
        if (*at == '-' || *at == ' ') continue;
        char value = (char) toupper((unsigned char) *at);
        if (!((value >= 'A' && value <= 'Z' && value != 'I' && value != 'O') || (value >= '2' && value <= '9'))) {
            strcpy(browserPairingStatus, "INVALID PAIRING CODE");
            browserPairingStatusUntil = osGetTime() + 5000;
            return;
        }
        compact[length++] = value;
    }
    if (length != 8) {
        strcpy(browserPairingStatus, "INVALID PAIRING CODE");
        browserPairingStatusUntil = osGetTime() + 5000;
        return;
    }
    snprintf(code, sizeof(code), "%.4s-%.4s", compact, compact + 4);
    char packet[80];
    snprintf(packet, sizeof(packet), "{\"type\":\"pair_browser_approve\",\"code\":\"%s\"}\n", code);
    if (onlineSend(packet)) strcpy(browserPairingStatus, "PAIRING APPROVAL SENT");
    else strcpy(browserPairingStatus, "PAIRING SEND FAILED");
    browserPairingStatusUntil = osGetTime() + 5000;
}

static bool typedConfirmation(const char* hint, const char* expected) {
    SwkbdState keyboard; char entered[32] = {};
    swkbdInit(&keyboard, SWKBD_TYPE_QWERTY, 1, sizeof(entered)-1);
    swkbdSetHintText(&keyboard, hint);
    if (swkbdInputText(&keyboard, entered, sizeof(entered)) != SWKBD_BUTTON_CONFIRM) return false;
    for (char* at=entered;*at;++at) *at=(char)toupper((unsigned char)*at);
    return !strcmp(entered, expected);
}

static void enableStatsUpload(void) {
    if (!typedConfirmation("Type YES: upload Seen, Caught, Badges, Frontier", "YES")) {
        strcpy(statsStatus, "NOT ENABLED - NO DATA UPLOADED"); statsStatusUntil=osGetTime()+5000; return;
    }
    statsEnabled=statsSeenEnabled=statsCaughtEnabled=statsBadgesEnabled=statsFrontierEnabled=true;
    if (!saveStatsConfig()) { statsEnabled=false; strcpy(statsStatus,"COULD NOT SAVE STATS.CFG"); return; }
    strcpy(statsStatus,"CONSENT SAVED - SYNCING"); statsStatusUntil=osGetTime()+5000;
    if (onlineAuthenticated) { sendStatsConsent(false); sendStatsSnapshot(); }
}

static void toggleStatsField(unsigned index) {
    if (!statsEnabled || index>3) return;
    bool* fields[] = {&statsSeenEnabled,&statsCaughtEnabled,&statsBadgesEnabled,&statsFrontierEnabled};
    *fields[index]=!*fields[index];
    if (!saveStatsConfig()) { *fields[index]=!*fields[index]; strcpy(statsStatus,"COULD NOT SAVE STATS.CFG"); return; }
    strcpy(statsStatus,*fields[index]?"FIELD ENABLED - SYNCING":"FIELD DISABLED - SERVER DATA REMOVED"); statsStatusUntil=osGetTime()+5000;
    if (onlineAuthenticated) { sendStatsConsent(false); if (*fields[index]) sendStatsSnapshot(); }
}

static void deleteStatsHistory(void) {
    if (!typedConfirmation("Type DELETE to erase all uploaded stats", "DELETE")) {
        strcpy(statsStatus,"DELETE CANCELLED"); statsStatusUntil=osGetTime()+4000; return;
    }
    statsEnabled=statsSeenEnabled=statsCaughtEnabled=statsBadgesEnabled=statsFrontierEnabled=false;
    saveStatsConfig();
    if (onlineAuthenticated) sendStatsConsent(true);
    strcpy(statsStatus,"DELETE SENT - UPLOADS OFF"); statsStatusUntil=osGetTime()+6000;
}

static void syncStatsNow(void) {
    saveStats=readSaveStats();
    if (!statsEnabled) return enableStatsUpload();
    if (!onlineAuthenticated) { strcpy(statsStatus,"CONNECT ONLINE TO SYNC"); statsStatusUntil=osGetTime()+4000; return; }
    if (!saveStats.valid) { strcpy(statsStatus,"WAITING FOR VALID SAVE MEMORY"); statsStatusUntil=osGetTime()+4000; return; }
    sendStatsConsent(false); sendStatsSnapshot(); nextStatsUpload=osGetTime()+60000;
}

static void drawConnectionDot(float x, float y) {
    uint32_t color;
    if (onlineMode == ONLINE_ACTIVE) color = C2D_Color32(50, 205, 50, 255);
    else if (onlineMode == ONLINE_CONNECTING) color = C2D_Color32(255, 165, 0, 255);
    else if (onlineEnabled) color = C2D_Color32(220, 50, 50, 255);
    else color = C2D_Color32(120, 120, 120, 255);
    C2D_DrawEllipseSolid(x, y, .1f, 8, 8, color);
}

static void drawPageIndicators(float y) {
    static const uint32_t colors[] = {
        C2D_Color32(80, 164, 245, 255),  // Online
        C2D_Color32(80, 164, 245, 255),  // Users
        C2D_Color32(80, 164, 245, 255),  // Chat
        C2D_Color32(130, 200, 80, 255),  // Party
        C2D_Color32(130, 200, 80, 255),  // Bag
        C2D_Color32(130, 200, 80, 255),  // Map
        C2D_Color32(160, 160, 160, 255), // Stats
        C2D_Color32(200, 130, 60, 255),  // Teleport
        C2D_Color32(200, 100, 160, 255), // Update
    };
    const float startX = 160 - (9 * 14) / 2.0f;
    for (unsigned page = 0; page < 9; ++page) {
        float cx = startX + page * 14 + 4;
        uint32_t dotColor = (page == (unsigned) bottomPage) ? C2D_Color32(255, 255, 255, 255) : colors[page];
        C2D_DrawEllipseSolid(cx, y, .1f, 5, 5, dotColor);
    }
}

static void drawBottom(void) {
    C2D_TargetClear(bottomTarget, C2D_Color32(11, 36, 26, 255));
    C2D_SceneBegin(bottomTarget);
    C2D_DrawRectSolid(0, 0, 0, 320, 38, C2D_Color32(16, 45, 34, 255));
    C2D_DrawRectSolid(0, 36, 0, 320, 2, C2D_Color32(47, 184, 230, 255));
    C2D_TextBufClear(textBuffer);
    const char* title = bottomPage == PAGE_USERS ? "ONLINE USERS - READ ONLY" :
        bottomPage == PAGE_CHAT ? "CHAT" :
        bottomPage == PAGE_PARTY ? "PARTY - LOCAL ONLY" :
        bottomPage == PAGE_BAG ? "BAG - LOCAL ONLY" :
        bottomPage == PAGE_MAP ? "MAP & TRAINER RADAR" :
        bottomPage == PAGE_STATS ? "PLAYER STATS & CONSENT" :
        bottomPage == PAGE_TELEPORT ? "TELEPORT" :
        bottomPage == PAGE_UPDATE ? "SYSTEM UPDATE" : "EMERALD ONLINE";
    drawText(16, 11, .55f, C2D_Color32(255,255,255,255), "%s", title);
    drawConnectionDot(306, 16);
    drawText(280, 14, .30f, C2D_Color32(180,220,205,255), "Y >");
    drawPageIndicators(31);
    if (bottomPage == PAGE_UPDATE) { drawUpdatePage(); return; }
    if (bottomPage == PAGE_TELEPORT) { drawTeleportPage(); return; }
    if (bottomPage == PAGE_USERS) { drawOnlineUsersPage(); return; }
    if (bottomPage == PAGE_CHAT) { drawChatPage(); return; }
    if (bottomPage == PAGE_STATS) { drawStatsPage(); return; }
    if (bottomPage == PAGE_MAP) { drawMapPage(); return; }
    if (bottomPage == PAGE_BAG) { drawBagPage(); return; }
    if (bottomPage == PAGE_PARTY) {
        if (!gbaEwram) drawText(30, 95, .48f, C2D_Color32(190,210,200,255), "Waiting for Emerald memory...");
        else {
            unsigned count = gbaEwram[0x244E9];
            if (count > 6) count = 0;
            for (unsigned i = 0; i < 6; ++i) {
                float y = 45 + i * 28;
                C2D_DrawRectSolid(10, y, 0, 300, 24, C2D_Color32(i & 1 ? 22 : 25, i & 1 ? 61 : 74, i & 1 ? 46 : 54, 255));
                if (i >= count) continue;
                size_t base = 0x244EC + i * 100;
                char nickname[11] = {};
                for (int j = 0; j < 10 && gbaEwram[base + 8 + j] != 0xFF; ++j) nickname[j] = decodeEmerald(gbaEwram[base + 8 + j]);
                uint8_t level = gbaEwram[base + 84];
                uint16_t hp = read16(gbaEwram, base + 86), maxHp = read16(gbaEwram, base + 88);
                drawText(18, y + 5, .42f, C2D_Color32(255,255,255,255), "%u  %.10s", i + 1, nickname);
                drawText(190, y + 5, .39f, C2D_Color32(190,220,210,255), "Lv%u", level);
                drawText(248, y + 5, .39f, C2D_Color32(255,255,255,255), "%u/%u", hp, maxHp);
            }
        }
        drawText(119, 222, .38f, C2D_Color32(190,220,210,255), "Y  BAG");
        return;
    }
    const char* status = onlineMode == ONLINE_ACTIVE ? "ONLINE" : onlineMode == ONLINE_CONNECTING ? "CONNECTING" : onlineEnabled ? "RETRYING" : "OFFLINE";
    uint32_t statusColor = onlineMode == ONLINE_ACTIVE ? C2D_Color32(78,168,95,255) : onlineEnabled ? C2D_Color32(58,143,207,255) : C2D_Color32(77,80,96,255);
    C2D_DrawRectSolid(205, 7, 0, 103, 24, statusColor);
    drawText(225, 12, .42f, C2D_Color32(255,255,255,255), "%s", status);
    C2D_DrawRectSolid(10, 46, 0, 300, 43, C2D_Color32(25,74,54,255));
        drawText(20, 52, .43f, C2D_Color32(160,232,255,255), "%s", trainerName);
        if (identityFingerprint[0]) drawText(126, 52, .32f, C2D_Color32(185,215,205,255), "ID %s", identityFingerprint);
        if (strcmp(trainerRole, "player")) {
            uint32_t localRoleColor = roleColor(trainerRole);
            C2D_DrawRectSolid(198, 49, .05f, 52, 18, localRoleColor);
            drawText(224, 52, .28f, C2D_Color32(255,255,255,255), "%s", roleLabel(trainerRole));
        }
    drawText(270, 52, .43f, C2D_Color32(200,220,220,255), "%u FPS", measuredFps);
    if (presence.valid) drawText(20, 70, .38f, C2D_Color32(255,255,255,255), "MAP %u-%u   TILE %d,%d", presence.mapGroup, presence.mapNum, presence.x, presence.y);
    else drawText(20, 70, .38f, C2D_Color32(210,220,215,255), "Waiting for the overworld...");
        if (recoveryCode[0]) drawText(22, 91, .31f, C2D_Color32(255,220,130,255), "RECOVERY %s  WRITE THIS DOWN", recoveryCode);
        else if (browserPairingStatus[0] && osGetTime() < browserPairingStatusUntil) drawText(75, 91, .32f, C2D_Color32(255,220,130,255), "%s", browserPairingStatus);
        else if (onlineMode != ONLINE_ACTIVE)
            drawText(18, 91, .27f, C2D_Color32(180,205,200,255), "v%s %s:%u", APP_VERSION, serverHost, serverPort);
        else drawText(80, 91, .30f, C2D_Color32(180,205,200,255), "TAP PROFILE TO PAIR BROWSER");
    if (onlineMode != ONLINE_ACTIVE) {
        static const char* stages[] = {"SOCKET", "TLS INIT", "TLS SETUP", "TLS HANDSHAKE", "CERT VERIFY", "WS REQUEST", "WS RESPONSE", "WS ACCEPT"};
        const char* stage = onlineProtocolStage >= 0 && onlineProtocolStage <= 7 ? stages[onlineProtocolStage] : "UNKNOWN";
        C2D_DrawRectSolid(10, 104, 0, 300, 90, C2D_Color32(44,52,49,255));
        drawText(20, 110, .40f, C2D_Color32(160,232,255,255), "NETWORK DIAGNOSTIC");
        drawText(20, 130, .39f, C2D_Color32(255,220,130,255), "E%d  %s  (STAGE %d)", onlineLastError, stage, onlineProtocolStage);
        drawText(20, 150, .38f, C2D_Color32(255,255,255,255), "TLS RESULT  %d", onlineTlsResult);
        drawText(20, 169, .34f, C2D_Color32(255,255,255,255), "VERIFY %08lX   CLOCK +%ds", (unsigned long) onlineTlsVerify, onlineTlsFutureSkew);
        drawText(20, 186, .24f, C2D_Color32(180,205,200,255), "LOG /3ds/emerald-online-3ds/gpsp-debug.log");
    } else {
        C2D_DrawRectSolid(10, 104, 0, 145, 90, C2D_Color32(22,61,46,255));
        C2D_DrawRectSolid(165, 104, 0, 145, 90, C2D_Color32(22,61,46,255));
        drawText(20, 110, .34f, C2D_Color32(160,232,255,255), "NEARBY %d / ONLINE %u", remoteCount, onlineUserCount);
        for (int i = 0; i < remoteCount && i < 3; ++i) drawText(20, 130 + i * 17, .36f, C2D_Color32(255,255,255,255), "%.12s  %d,%d", remoteTrainers[i].name, remoteTrainers[i].x, remoteTrainers[i].y);
        if (!remoteCount) drawText(27, 145, .34f, C2D_Color32(180,205,200,255), "Tap for all users");
        drawText(175, 110, .38f, C2D_Color32(160,232,255,255), "MAP CHAT");
        if (lastChatText[0]) {
            drawText(175, 130, .34f, C2D_Color32(160,232,255,255), "%.12s", lastChatName);
            drawText(175, 150, .32f, C2D_Color32(255,255,255,255), "%.20s", lastChatText);
            if (strlen(lastChatText) > 20) drawText(175, 168, .32f, C2D_Color32(255,255,255,255), "%.20s", lastChatText + 20);
        } else drawText(181, 145, .34f, C2D_Color32(180,205,200,255), "Tap for messages");
    }
    const uint32_t colors[4] = {C2D_Color32(41,93,66,255),C2D_Color32(66,80,165,255),C2D_Color32(58,118,80,255),C2D_Color32(98,87,46,255)};
    const char* labels[4] = {"WAVE","BATTLE","TRADE","GG"};
    for (int i = 0; i < 4; ++i) {
        C2D_DrawRectSolid(i * 81, 202, 0, i == 2 ? 77 : 78, 38, colors[i]);
        drawText(i * 81 + 17, 214, .36f, C2D_Color32(255,255,255,255), "%s", labels[i]);
    }
    if (linkConfigured) drawText(12, 193, .24f, C2D_Color32(255,220,130,255), "%.36s TX%u RX%u", linkStatus, linkPacketsSent, linkPacketsReceived);
}

static unsigned filteredTeleportCount(void) {
    unsigned count = 0;
    for (unsigned i = 0; i < teleportDestinationCount; ++i)
        if (teleportKindMatches(teleportDestinations[i].kind)) ++count;
    return count;
}

static void handleRepeatInput(void) {
    if (!repeatKeys) return;
    if (repeatKeys & KEY_Y) {
        bottomPage = (BottomPage) (((unsigned) bottomPage + 1) % 9);
        return;
    }
    if (bottomPage == PAGE_TELEPORT) {
        const unsigned categoryCount = teleportCustomVisible ? 6 : 5;
        if (repeatKeys & (KEY_LEFT | KEY_CPAD_LEFT)) {
            teleportCategory = (teleportCategory + categoryCount - 1) % categoryCount;
            teleportScroll = 0;
            teleportSelectedIndex = -1;
        }
        if (repeatKeys & (KEY_RIGHT | KEY_CPAD_RIGHT)) {
            teleportCategory = (teleportCategory + 1) % categoryCount;
            teleportScroll = 0;
            teleportSelectedIndex = -1;
        }
        const unsigned filteredCount = filteredTeleportCount();
        const unsigned maxRows = 7;
        if ((repeatKeys & (KEY_UP | KEY_CPAD_UP)) && teleportScroll) --teleportScroll;
        if ((repeatKeys & (KEY_DOWN | KEY_CPAD_DOWN)) && teleportScroll + maxRows < filteredCount) ++teleportScroll;
    } else if (bottomPage == PAGE_USERS) {
        const unsigned pageCount = onlineUserCount ? (onlineUserCount + 5) / 6 : 1;
        if ((repeatKeys & (KEY_LEFT | KEY_CPAD_LEFT)) && onlineUserPage) --onlineUserPage;
        if ((repeatKeys & (KEY_RIGHT | KEY_CPAD_RIGHT)) && onlineUserPage + 1 < pageCount) ++onlineUserPage;
    } else if (bottomPage == PAGE_CHAT && chatDetailIndex < 0) {
        unsigned indices[24];
        const unsigned count = currentChatIndices(indices);
        const unsigned pageCount = count ? (count + 2) / 3 : 1;
        if ((repeatKeys & (KEY_LEFT | KEY_CPAD_LEFT)) && chatPage) --chatPage;
        if ((repeatKeys & (KEY_RIGHT | KEY_CPAD_RIGHT)) && chatPage + 1 < pageCount) ++chatPage;
    } else if (bottomPage == PAGE_BAG) {
        if (repeatKeys & (KEY_LEFT | KEY_CPAD_LEFT)) { bagPocket = (bagPocket + 4) % 5; bagPage = 0; }
        if (repeatKeys & (KEY_RIGHT | KEY_CPAD_RIGHT)) { bagPocket = (bagPocket + 1) % 5; bagPage = 0; }
        if ((repeatKeys & (KEY_UP | KEY_CPAD_UP)) && bagPage) --bagPage;
        if (repeatKeys & (KEY_DOWN | KEY_CPAD_DOWN)) ++bagPage;
    }
}

static void drawRemoteTrainer(const RemoteTrainer* trainer, float x, float y) {
    if (avatarSheet) {
        unsigned frame;
        bool flip = false;
        // Emerald stores each direction as idle, step A, and step B. Use an
        // idle/A/idle/B cadence so animation never crosses into another
        // direction's frames.
        unsigned phase = (osGetTime() / 160) & 3;
        if (trainer->facing == 1) {
            static const unsigned downFrames[4] = {0, 3, 0, 4};
            frame = downFrames[phase];
        } else if (trainer->facing == 2) {
            static const unsigned upFrames[4] = {1, 5, 1, 6};
            frame = upFrames[phase];
        } else {
            static const unsigned sideFrames[4] = {2, 7, 2, 8};
            frame = sideFrames[phase];
            flip = trainer->facing == 4;
        }
        C2D_Image image = C2D_SpriteSheetGetImage(avatarSheet, (trainer->isGirl ? 9 : 0) + frame);
        C2D_DrawImageAt(image, flip ? x + 24 : x, y, .36f, NULL, flip ? -1.5f : 1.5f, 1.5f);
        return;
    }
    const float z = 0.35f;
    const bool step = ((osGetTime() / 180) + trainer->x + trainer->y) & 1;
    const float bob = step ? 1.0f : 0.0f;
    const uint32_t outline = C2D_Color32(25, 35, 45, 245);
    const uint32_t skin = C2D_Color32(244, 190, 145, 255);
    const uint32_t cap = C2D_Color32(225, 58, 70, 255);
    const uint32_t shirt = C2D_Color32(48, 126, 205, 255);
    const uint32_t pack = C2D_Color32(244, 196, 61, 255);
    const uint32_t pants = C2D_Color32(42, 58, 92, 255);

    // Shadow and outlined pixel-art silhouette, sized to remain readable over
    // Emerald's upscaled 400x240 framebuffer on an Old 3DS display.
    C2D_DrawEllipseSolid(x + 2, y + 31, z, 22, 6, C2D_Color32(0, 0, 0, 100));
    C2D_DrawRectSolid(x + 4, y + 5 + bob, z, 16, 12, outline);
    C2D_DrawRectSolid(x + 6, y + 7 + bob, z + .01f, 12, 9, skin);
    C2D_DrawRectSolid(x + 3, y + 3 + bob, z + .02f, 18, 5, cap);
    if (trainer->facing == 3) C2D_DrawRectSolid(x, y + 6 + bob, z + .02f, 6, 3, cap);
    else if (trainer->facing == 4) C2D_DrawRectSolid(x + 18, y + 6 + bob, z + .02f, 6, 3, cap);
    else C2D_DrawRectSolid(x + 8, y + 1 + bob, z + .02f, 11, 3, cap);
    C2D_DrawRectSolid(x + 3, y + 16 + bob, z, 18, 12, outline);
    C2D_DrawRectSolid(x + 5, y + 17 + bob, z + .01f, 14, 10, shirt);
    C2D_DrawRectSolid(x + (trainer->facing == 3 ? 15 : 5), y + 18 + bob, z + .02f, 4, 7, pack);
    C2D_DrawRectSolid(x, y + 18 + bob, z, 5, 9, skin);
    C2D_DrawRectSolid(x + 19, y + 18 + bob, z, 5, 9, skin);
    C2D_DrawRectSolid(x + 5, y + 27 + bob, z, 6, step ? 7 : 5, pants);
    C2D_DrawRectSolid(x + 13, y + 27 + bob, z, 6, step ? 5 : 7, pants);
}

static void drawTop(void) {
    C2D_TargetClear(topTarget, C2D_Color32(0,0,0,255));
    C2D_SceneBegin(topTarget);
    if (videoReady) C2D_DrawImageAt(gameImage, 0, 0, 0, NULL, 400.0f / 240.0f, 240.0f / 160.0f);
    // Coordinates remain populated while Emerald is in battles and menus.
    // Recheck callback2 at draw time so stale presence can never place a
    // network trainer over a non-overworld framebuffer.
    if (!isEmeraldOverworld() || !presence.valid) return;
    C2D_TextBufClear(textBuffer);
    for (int i = 0; i < remoteCount; ++i) {
        int dx = remoteTrainers[i].x - presence.x, dy = remoteTrainers[i].y - presence.y;
        if (dx < -8 || dx > 8 || dy < -6 || dy > 6) continue;
        float x = 200 + dx * 26.67f - 12, y = 120 + dy * 24.0f - 23;
        drawRemoteTrainer(&remoteTrainers[i], x, y);
        drawText(x - 9, y - 12, .32f, C2D_Color32(255,255,255,255), "%.8s", remoteTrainers[i].name);
        if (remoteTrainers[i].emote && osGetTime() < remoteTrainers[i].emoteUntil) {
            static const char* bubbles[] = {"", "HI", "!", "<>", "GG"};
            C2D_DrawRectSolid(x + 17, y - 28, .4f, 22, 15, C2D_Color32(255,255,240,235));
            drawText(x + 20, y - 26, .34f, C2D_Color32(35,45,50,255), "%s", bubbles[remoteTrainers[i].emote]);
        }
    }
}

static bool initGraphics(void) {
    gfxInitDefault();
    debugStage("gfx-ready");
    gfxSetWide(false);
    if (!C3D_Init(C3D_DEFAULT_CMDBUF_SIZE)) return false;
    debugStage("c3d-ready");
    if (!C2D_Init(C2D_DEFAULT_MAX_OBJECTS)) return false;
    debugStage("c2d-ready");
    C2D_Prepare();
    debugStage("c2d-prepared");
    topTarget = C2D_CreateScreenTarget(GFX_TOP, GFX_LEFT);
    bottomTarget = C2D_CreateScreenTarget(GFX_BOTTOM, GFX_LEFT);
    debugStage("targets-ready");
    gameUploadBuffer = (uint16_t*) linearMemAlign(256 * 256 * sizeof(uint16_t), 128);
    if (!topTarget || !bottomTarget || !gameUploadBuffer || !C3D_TexInitVRAM(&gameTexture, 256, 256, GPU_RGB565)) return false;
    memset(gameUploadBuffer, 0, 256 * 256 * sizeof(uint16_t));
    debugStage("texture-ready");
    C3D_TexSetFilter(&gameTexture, GPU_LINEAR, GPU_LINEAR);
    C3D_TexSetWrap(&gameTexture, GPU_CLAMP_TO_EDGE, GPU_CLAMP_TO_EDGE);
    uiFont = C2D_FontLoadSystem(CFG_REGION_USA);
    avatarSheet = C2D_SpriteSheetLoad(AVATAR_PATH);
    debugStage("font-ready");
    textBuffer = C2D_TextBufNew(4096);
    debugStage("text-ready");
    return textBuffer != NULL;
}

static void uploadVideo(void) {
    if (!videoReady || !videoPixels || !gameUploadBuffer) return;
    // DisplayTransfer scales when its input/output dimensions differ. Pad the
    // 240x160 frame to the texture's exact 256x256 dimensions first so the
    // visible subtexture is neither stretched into the padding nor corrupted.
    // FLIP_VERT operates across the complete 256-row transfer. Place the GBA
    // image in the lower 160 source rows so it lands in the texture region
    // addressed by the standard top-left 240x160 Citro2D subtexture. Reverse
    // the rows here because DisplayTransfer's full-texture flip would
    // otherwise leave the visible GBA frame upside down.
    for (unsigned y = 0; y < 160; ++y)
        memcpy(gameUploadBuffer + (y + 96) * 256,
               (const uint8_t*)videoPixels + (159 - y) * videoPitch,
               240 * sizeof(uint16_t));
    GSPGPU_FlushDataCache(gameUploadBuffer, 256 * 256 * sizeof(uint16_t));
    C3D_SyncDisplayTransfer((u32*) gameUploadBuffer, GX_BUFFER_DIM(256, 256), (u32*) gameTexture.data, GX_BUFFER_DIM(256, 256), GX_TRANSFER_IN_FORMAT(GX_TRANSFER_FMT_RGB565) | GX_TRANSFER_OUT_FORMAT(GX_TRANSFER_FMT_RGB565) | GX_TRANSFER_OUT_TILED(1) | GX_TRANSFER_FLIP_VERT(1) | GX_TRANSFER_SCALING(GX_TRANSFER_SCALE_NO));
}

int main(void) {
    remove(DEBUG_LOG_PATH);
    debugStage("main");
    // On New 3DS hardware this enables the faster CPU clock and L2 cache. It
    // is harmless on Old 3DS and keeps RFU sessions from falling behind when
    // TLS, emulation, and both-screen rendering are active together.
    osSetSpeedupEnable(true);
    debugStage("new3ds-speedup-requested");
        loadConfig();
        loadIdentity();
        loadStatsConfig();
    debugStage("config-loaded");
    socBuffer = (uint32_t*) memalign(0x1000, SOC_BUFFER_SIZE);
    if (!socBuffer || R_FAILED(socInit(socBuffer, SOC_BUFFER_SIZE))) {
        if (socBuffer) free(socBuffer);
        socBuffer = NULL;
        onlineEnabled = false;
    }
    debugStage(socBuffer ? "soc-ready" : "soc-unavailable");
    if (!initGraphics()) return 1;
    debugStage("graphics-ready");
    // The shared TLS config lives in the HTTP client, but the WebSocket keeps
    // its own persistent SSL context so session resets work across reconnects.
    if (httpClientInit()) {
        mbedtls_ssl_init(&tlsContext);
        if (mbedtls_ssl_setup(&tlsContext, &tlsConfig)) {
            mbedtls_ssl_free(&tlsContext);
            httpClientShutdown();
            onlineEnabled = false;
        }
    } else {
        onlineEnabled = false;
    }
    if (R_SUCCEEDED(ndspInit())) {
        ndspSetOutputMode(NDSP_OUTPUT_STEREO);
        ndspChnReset(0);
        ndspChnSetFormat(0, NDSP_FORMAT_STEREO_PCM16);
        ndspChnSetInterp(0, NDSP_INTERP_LINEAR);
        audioData = (int16_t*) linearAlloc(AUDIO_BUFFERS * AUDIO_FRAMES * 2 * sizeof(int16_t));
    }
    debugStage("audio-ready");

    retro_set_environment(environmentCallback);
    retro_set_video_refresh(videoCallback);
    retro_set_audio_sample(audioSampleCallback);
    retro_set_audio_sample_batch(audioBatchCallback);
    retro_set_input_poll(inputPollCallback);
    retro_set_input_state(inputStateCallback);
    debugStage("callbacks-ready");
    if (dynarecEnabled) {
        Result svchaxResult = svchax_init(false);
        debugStage(R_SUCCEEDED(svchaxResult) && __ctr_svchax ? "svchax-ready" : "svchax-failed");
    } else {
        debugStage("svchax-skipped");
    }
    retro_init();
    debugStage("retro-init-ready");
    retro_game_info game = {ROM_PATH, NULL, 0, NULL};
    if (!retro_load_game(&game)) {
        debugStage("rom-load-failed");
        C3D_FrameBegin(C3D_FRAME_SYNCDRAW);
        C2D_TargetClear(bottomTarget, C2D_Color32(30,15,15,255));
        C2D_SceneBegin(bottomTarget);
        C2D_TextBufClear(textBuffer);
        drawText(18, 80, .55f, C2D_Color32(255,255,255,255), "Could not load emerald.gba");
        drawText(18, 115, .38f, C2D_Color32(255,200,200,255), "/3ds/emerald-online-3ds/");
        C3D_FrameEnd(0);
        while (aptMainLoop()) { hidScanInput(); if (hidKeysDown() & KEY_START) break; gspWaitForVBlank(); }
        quitRequested = true;
    } else {
        debugStage("rom-loaded");
        // This frontend statically links gpSP, so bind its exported RAM arrays
        // directly as a robust fallback to the optional libretro memory map.
        gbaEwram = gpspEwram;
        gbaIwram = gpspIwram + 0x8000;
        debugStage("gba-memory-bound");
        // gpSP applies gpsp_sound_rate while loading content. Querying AV info
        // before retro_load_game leaves NDSP at the 65536 Hz default while the
        // core emits 32768 Hz blocks, making every block play too quickly and
        // producing a gap between frames.
        retro_system_av_info av = {};
        retro_get_system_av_info(&av);
        audioRate = av.timing.sample_rate;
        ndspChnSetRate(0, audioRate);
        debugStage(audioRate == 32768.0 ? "audio-rate-32768" : "audio-rate-other");
        loadSave();
        loadPrivateItemNames();
        debugStage("save-loaded");
        if (onlineEnabled) onlineConnect();
        debugStage("online-started");
    }

    while (!quitRequested && aptMainLoop()) {
        hidScanInput();
        heldKeys = hidKeysHeld();
        repeatKeys = hidKeysDownRepeat();
        uint32_t down = hidKeysDown();
        uint64_t now = osGetTime();
        if (down & KEY_X) onlineToggle();
        handleRepeatInput();
        if ((down & KEY_TOUCH) && now >= touchDebounceUntil) {
            touchDebounceUntil = now + TOUCH_DEBOUNCE_MS;
            touchPosition touch;
            hidTouchRead(&touch);
            if (bottomPage == PAGE_USERS && touch.py >= 210) {
                const unsigned pageCount = onlineUserCount ? (onlineUserCount + 5) / 6 : 1;
                if (touch.px < 160) { if (onlineUserPage) --onlineUserPage; }
                else if (onlineUserPage + 1 < pageCount) ++onlineUserPage;
            } else if (bottomPage == PAGE_CHAT && touch.py >= 40 && touch.py < 68) {
                globalChat = touch.px >= 160;
                chatPage = 0;
                chatDetailIndex = -1;
            } else if (bottomPage == PAGE_CHAT && chatDetailIndex >= 0) {
                if (touch.py >= 210) chatDetailIndex = -1;
            } else if (bottomPage == PAGE_CHAT && touch.py >= 86 && touch.py < 207) {
                unsigned indices[24];
                const unsigned count = currentChatIndices(indices);
                const unsigned visible = chatPage * 3 + (touch.py - 86) / 40;
                if (visible < count) chatDetailIndex = (int) indices[visible];
            } else if (bottomPage == PAGE_CHAT && touch.py >= 210) {
                unsigned indices[24];
                const unsigned count = currentChatIndices(indices);
                const unsigned pageCount = count ? (count + 2) / 3 : 1;
                if (chatPage >= pageCount) chatPage = pageCount - 1;
                if (touch.px < 108) { if (chatPage) --chatPage; }
                else if (touch.px < 212) openChat();
                else if (chatPage + 1 < pageCount) ++chatPage;
            } else if (bottomPage == PAGE_STATS) {
                if (touch.py >= 82 && touch.py < 194) toggleStatsField((touch.py - 82) / 28);
                else if (touch.py >= 208 && (!statsEnabled || touch.px < 160)) syncStatsNow();
                else if (touch.py >= 208 && touch.px >= 160) deleteStatsHistory();
            } else if (bottomPage == PAGE_BAG) {
                if (touch.py >= 40 && touch.py < 72) { bagPocket = touch.px / 64; if (bagPocket > 4) bagPocket = 4; bagPage = 0; }
                else if (touch.py >= 210 && touch.px < 160) { if (bagPage) --bagPage; }
                else if (touch.py >= 210 && touch.px >= 160) ++bagPage;
            } else if (bottomPage == PAGE_TELEPORT) {
                const unsigned categoryCount = teleportCustomVisible ? 6 : 5;
                const float tabWidth = 300.0f / categoryCount;
                if (touch.py >= 42 && touch.py < 64) {
                    unsigned cat = (unsigned)((touch.px - 10) / tabWidth);
                    if (cat < categoryCount) { teleportCategory = cat; teleportScroll = 0; teleportSelectedIndex = -1; }
                } else if (touch.py >= 70 && touch.py < 210) {
                    unsigned filtered[64];
                    unsigned filteredCount = 0;
                    for (unsigned i = 0; i < teleportDestinationCount; ++i)
                        if (teleportKindMatches(teleportDestinations[i].kind)) filtered[filteredCount++] = i;
                    int row = (int)((touch.py - 70) / 20);
                    unsigned visible = teleportScroll + row;
                    if (row >= 0 && visible < filteredCount) teleportSelectedIndex = (int)filtered[visible];
                } else if (touch.py >= 216) {
                    if (teleportSelectedIndex >= 0 && teleportSelectedIndex < (int)teleportDestinationCount) {
                        const TeleportDestination* dest = &teleportDestinations[teleportSelectedIndex];
                        char packet[96];
                        snprintf(packet, sizeof(packet), "{\"type\":\"teleport\",\"destination_id\":\"%s\"}\n", dest->id);
                        onlineSend(packet);
                    } else if (teleportCategory == 5 && canCreateCustomTeleport() && teleportScroll == 0 && touch.px < 160) {
                        proposeCustomTeleport();
                    }
                }
            } else if (bottomPage == PAGE_UPDATE) {
                if (touch.py >= 166 && touch.py < 190 && (updateState == UPDATE_IDLE || updateState == UPDATE_CHECKING || updateState == UPDATE_AVAILABLE || updateState == UPDATE_ERROR)) {
                    checkForUpdate();
                } else if (touch.py >= 194 && touch.py < 218) {
                    if (updateState == UPDATE_AVAILABLE) startUpdateDownload();
                    else if (updateState == UPDATE_READY) installUpdate();
                    else if (updateState == UPDATE_DONE) quitRequested = true;
                }
            } else if (bottomPage == PAGE_ONLINE && touch.py >= 202) sendEmote(touch.px / 81);
            else if (bottomPage == PAGE_ONLINE && touch.py >= 46 && touch.py < 90) openBrowserPairing();
            else if (bottomPage == PAGE_ONLINE && touch.px < 155 && touch.py >= 104 && touch.py < 194) bottomPage = PAGE_USERS;
            else if (bottomPage == PAGE_ONLINE && touch.px >= 165 && touch.py >= 104 && touch.py < 194) bottomPage = PAGE_CHAT;
        }
        retro_run();
        static bool firstFrameLogged;
        if (!firstFrameLogged) { debugStage("first-frame"); firstFrameLogged = true; }
        presence = readPresence();
        recordMapTrail(presence);
        updateTrainerNameFromSave();
        now = osGetTime();
        // Save-derived aggregates change slowly. Re-reading the Pokédex flags
        // every emulated frame wastes Old 3DS CPU time without improving UI or
        // upload freshness, so refresh the cached summary once per second.
        if (now >= nextStatsRead) { saveStats = readSaveStats(); nextStatsRead = now + 1000; }
        // RFU response windows are much tighter than ordinary presence sync.
        // While linked, service the nonblocking socket once per emulated frame.
        if (now >= nextOnlinePoll) { nextOnlinePoll = now + (linkStarted ? 1 : 100); onlineUpdate(); }
        if (now >= nextSaveCheck) { nextSaveCheck = now + 5000; writeSave(false); }
        if (!fpsStarted) fpsStarted = now;
        if (++fpsFrames && now - fpsStarted >= 1000) {
            measuredFps = fpsFrames * 1000 / (now - fpsStarted);
            fpsFrames = 0;
            fpsStarted = now;
        }
        uploadVideo();
        C3D_FrameBegin(C3D_FRAME_SYNCDRAW);
        drawTop();
        if (renderedFrames < 2 || renderedFrames % 5 == 0) drawBottom();
        ++renderedFrames;
        C3D_FrameEnd(0);
    }

    writeSave(true);
    onlineDisconnect();
    retro_unload_game();
    retro_deinit();
    if (audioData) linearFree(audioData);
    ndspExit();
    if (textBuffer) C2D_TextBufDelete(textBuffer);
    if (uiFont) C2D_FontFree(uiFont);
    if (avatarSheet) C2D_SpriteSheetFree(avatarSheet);
    C3D_TexDelete(&gameTexture);
    linearFree(gameUploadBuffer);
    C2D_Fini();
    C3D_Fini();
    gfxExit();
    mbedtls_ssl_free(&tlsContext);
    httpClientShutdown();
    if (socBuffer) { socExit(); free(socBuffer); }
    return 0;
}
