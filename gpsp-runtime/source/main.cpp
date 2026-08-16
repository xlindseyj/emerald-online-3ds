#include <3ds.h>
#include <citro2d.h>
#include <citro3d.h>

#include <arpa/inet.h>
#include <ctype.h>
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
#include <time.h>
#include <unistd.h>

#include <mbedtls/base64.h>
#include <mbedtls/ctr_drbg.h>
#include <mbedtls/entropy.h>
#include <mbedtls/net_sockets.h>
#include <mbedtls/sha1.h>
#include <mbedtls/ssl.h>
#include <mbedtls/x509_crt.h>

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
#define DEFAULT_HOST "live.emeraldonline3ds.com"
#define DEFAULT_PORT 443
#define DEFAULT_WEBSOCKET_PATH "/game"
#define SOC_BUFFER_SIZE 0x100000
#define AUDIO_BUFFERS 4
#define AUDIO_FRAMES 1024
#define DEBUG_LOG_PATH "sdmc:/3ds/emerald-online-3ds/gpsp-debug.log"
#define AVATAR_PATH "sdmc:/3ds/emerald-online-3ds/avatars.t3x"
#define APP_VERSION "0.5.0"

static C3D_RenderTarget* topTarget;
static C3D_RenderTarget* bottomTarget;
static C3D_Tex gameTexture;
static uint16_t* gameUploadBuffer;
static Tex3DS_SubTexture gameSubTex = {240, 160, 0.0f, 1.0f, 240.0f / 256.0f, 1.0f - 160.0f / 256.0f};
static C2D_Image gameImage = {&gameTexture, &gameSubTex};
static C2D_Font uiFont;
static C2D_SpriteSheet avatarSheet;
static C2D_TextBuf textBuffer;
static const uint16_t* videoPixels;
static size_t videoPitch;
static bool videoReady;
static uint32_t heldKeys;
static bool quitRequested;
static uint8_t* gbaEwram;
static uint8_t* gbaIwram;
static uint8_t* saveRam;
static size_t saveRamSize;
static uint32_t saveHash;
static uint64_t nextSaveCheck;
static unsigned measuredFps;
static unsigned fpsFrames;
static unsigned renderedFrames;
static uint64_t fpsStarted;
static bool partyPage;
static bool dynarecEnabled = true;

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

enum OnlineMode { ONLINE_OFFLINE, ONLINE_CONNECTING, ONLINE_ACTIVE };
static OnlineMode onlineMode = ONLINE_OFFLINE;
static int onlineSocket = -1;
static uint32_t* socBuffer;
static bool onlineEnabled = true;
static int onlineLastError;
static uint64_t connectStarted;
static uint64_t nextReconnect;
static uint64_t lastPing;
static uint64_t nextOnlinePoll;
static unsigned onlineSequence;
static char serverHost[254] = DEFAULT_HOST;
static in_addr serverAddress = {};
static uint64_t serverAddressResolvedAt;
static unsigned serverPort = DEFAULT_PORT;
static bool secureWebSocket = true;
static char webSocketPath[128] = DEFAULT_WEBSOCKET_PATH;
static char trainerName[13] = "Trainer";
static bool trainerNameFromSave;
static bool trainerIsGirl;
static char identityId[37];
static char identityToken[65];
static char credentialId[37];
static char identityFingerprint[11];
static char recoveryCode[25];
static char receiveBuffer[4097];
static size_t receiveLength;
static unsigned char webSocketBuffer[8192];
static size_t webSocketLength;
static mbedtls_entropy_context tlsEntropy;
static mbedtls_ctr_drbg_context tlsRandom;
static mbedtls_x509_crt tlsRoots;
static mbedtls_ssl_config tlsConfig;
static mbedtls_ssl_context tlsContext;
static bool tlsInitialized;
static bool tlsActive;
static int onlineProtocolStage;
static int onlineTlsResult;
static uint32_t onlineTlsVerify;
static int onlineTlsFutureSkew;
static char lastChatName[13];
static char lastChatText[81];
static char browserPairingStatus[40];
static uint64_t browserPairingStatusUntil;

static void debugNetworkFailure(void) {
    FILE* file = fopen(DEBUG_LOG_PATH, "a");
    if (!file) return;
    fprintf(file, "%llu wss-failed stage=%d tls=%d verify=%08lx skew=%d\n",
        (unsigned long long) osGetTime(), onlineProtocolStage, onlineTlsResult,
        (unsigned long) onlineTlsVerify, onlineTlsFutureSkew);
    fclose(file);
}

struct GamePresence {
    bool valid;
    uint8_t mapGroup;
    uint8_t mapNum;
    int16_t x;
    int16_t y;
    uint8_t facing;
};
static GamePresence presence;
static GamePresence lastSentPresence;

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
static RemoteTrainer remoteTrainers[8];
static int remoteCount;

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
    if (!strcmp(key, "gpsp_serial")) return "disabled";
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

static void writeSave(bool force) {
    if (!saveRam || !saveRamSize) return;
    uint32_t hash = hashBytes(saveRam, saveRamSize);
    if (!force && hash == saveHash) return;
    FILE* file = fopen(SAVE_PATH ".tmp", "wb");
    if (!file) return;
    bool good = fwrite(saveRam, 1, saveRamSize, file) == saveRamSize;
    fclose(file);
    if (good) {
        remove(SAVE_PATH);
        rename(SAVE_PATH ".tmp", SAVE_PATH);
        saveHash = hash;
    }
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

static char decodeEmerald(uint8_t value);
static void onlineDisconnect(void);

static GamePresence readPresence(void) {
    static GamePresence previous = {false, 0, 0, 0, 0, 1};
    GamePresence current = {false, 0, 0, 0, 0, (uint8_t) (previous.facing ? previous.facing : 1)};
    if (!gbaEwram || !gbaIwram) return current;
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

static const char* facingName(uint8_t facing) {
    if (facing == 2) return "up";
    if (facing == 3) return "left";
    if (facing == 4) return "right";
    return "down";
}

// Cloudflare currently serves lws-workspace.com through Google Trust Services.
// Trust the long-lived issuing root, not the rotating leaf or intermediate.
// Source: https://pki.goog/repo/certs/gtsr4.pem
static const char GOOGLE_TRUST_SERVICES_ROOT_R4[] =
    "-----BEGIN CERTIFICATE-----\n"
    "MIICCTCCAY6gAwIBAgINAgPlwGjvYxqccpBQUjAKBggqhkjOPQQDAzBHMQswCQYD\n"
    "VQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIG\n"
    "A1UEAxMLR1RTIFJvb3QgUjQwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAw\n"
    "WjBHMQswCQYDVQQGEwJVUzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2Vz\n"
    "IExMQzEUMBIGA1UEAxMLR1RTIFJvb3QgUjQwdjAQBgcqhkjOPQIBBgUrgQQAIgNi\n"
    "AATzdHOnaItgrkO4NcWBMHtLSZ37wWHO5t5GvWvVYRg1rkDdc/eJkTBa6zzuhXyi\n"
    "QHY7qca4R9gq55KRanPpsXI5nymfopjTX15YhmUPoYRlBtHci8nHc8iMai/lxKvR\n"
    "HYqjQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQW\n"
    "BBSATNbrdP9JNqPV2Py1PsVq8JQdjDAKBggqhkjOPQQDAwNpADBmAjEA6ED/g94D\n"
    "9J+uHXqnLrmvT/aDHQ4thQEd0dlq7A/Cr8deVl5c1RxYIigL9zC2L7F8AjEA8GE8\n"
    "p/SgguMh1YQdc4acLa/KNJvxn7kjNuK8YAOdgLOaVsjh4rsUecrNIdSUtUlD\n"
    "-----END CERTIFICATE-----\n";

static int tlsSocketSend(void* context, const unsigned char* data, size_t size) {
    int socket = *(int*) context;
    ssize_t result = send(socket, data, size, MSG_NOSIGNAL);
    if (result >= 0) return (int) result;
    if (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR) return MBEDTLS_ERR_SSL_WANT_WRITE;
    return MBEDTLS_ERR_NET_SEND_FAILED;
}

static int tlsSocketReceive(void* context, unsigned char* data, size_t size) {
    int socket = *(int*) context;
    ssize_t result = recv(socket, data, size, 0);
    if (result >= 0) return (int) result;
    if (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR) return MBEDTLS_ERR_SSL_WANT_READ;
    return MBEDTLS_ERR_NET_RECV_FAILED;
}

// The 3DS RTC stores the wall clock selected by the user, while this mbedTLS
// port interprets that value as UTC. That makes a newly issued certificate
// appear up to one timezone offset "from the future" (four hours in EDT).
// Permit only that single flag and only within the full civil-timezone range;
// hostname, signature, trust-chain, expiry, and every other check stay strict.
static int64_t daysFromCivil(int year, unsigned month, unsigned day) {
    year -= month <= 2;
    const int era = (year >= 0 ? year : year - 399) / 400;
    const unsigned yearOfEra = (unsigned) (year - era * 400);
    const unsigned dayOfYear = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1;
    const unsigned dayOfEra = yearOfEra * 365 + yearOfEra / 4 - yearOfEra / 100 + dayOfYear;
    return (int64_t) era * 146097 + dayOfEra - 719468;
}

static int64_t x509TimeSeconds(const mbedtls_x509_time* value) {
    return daysFromCivil(value->year, (unsigned) value->mon, (unsigned) value->day) * 86400 +
        value->hour * 3600 + value->min * 60 + value->sec;
}

static int tlsVerifyCertificate(void*, mbedtls_x509_crt* certificate, int, uint32_t* flags) {
    if (!certificate || !flags || !(*flags & MBEDTLS_X509_BADCERT_FUTURE)) return 0;
    const int64_t now = (int64_t) time(NULL);
    const int64_t notBefore = x509TimeSeconds(&certificate->valid_from);
    const int64_t skew = notBefore - now;
    if (now > 0 && skew >= 0 && skew <= 14 * 60 * 60) {
        *flags &= ~MBEDTLS_X509_BADCERT_FUTURE;
        if (skew > onlineTlsFutureSkew) onlineTlsFutureSkew = (int) skew;
    }
    return 0;
}

static bool tlsInitialize(void) {
    if (tlsInitialized) return true;
    mbedtls_entropy_init(&tlsEntropy);
    mbedtls_ctr_drbg_init(&tlsRandom);
    mbedtls_x509_crt_init(&tlsRoots);
    mbedtls_ssl_config_init(&tlsConfig);
    mbedtls_ssl_init(&tlsContext);
    static const unsigned char personalization[] = "emerald-online-3ds";
    if (mbedtls_ctr_drbg_seed(&tlsRandom, mbedtls_entropy_func, &tlsEntropy, personalization, sizeof(personalization) - 1) ||
        mbedtls_x509_crt_parse(&tlsRoots, (const unsigned char*) GOOGLE_TRUST_SERVICES_ROOT_R4, sizeof(GOOGLE_TRUST_SERVICES_ROOT_R4)) ||
        mbedtls_ssl_config_defaults(&tlsConfig, MBEDTLS_SSL_IS_CLIENT, MBEDTLS_SSL_TRANSPORT_STREAM, MBEDTLS_SSL_PRESET_DEFAULT)) return false;
    mbedtls_ssl_conf_authmode(&tlsConfig, MBEDTLS_SSL_VERIFY_REQUIRED);
    mbedtls_ssl_conf_ca_chain(&tlsConfig, &tlsRoots, NULL);
    mbedtls_ssl_conf_verify(&tlsConfig, tlsVerifyCertificate, NULL);
    mbedtls_ssl_conf_rng(&tlsConfig, mbedtls_ctr_drbg_random, &tlsRandom);
    if (mbedtls_ssl_setup(&tlsContext, &tlsConfig)) return false;
    tlsInitialized = true;
    return true;
}

static void tlsFinalize(void) {
    if (!tlsInitialized) return;
    mbedtls_ssl_free(&tlsContext);
    mbedtls_ssl_config_free(&tlsConfig);
    mbedtls_x509_crt_free(&tlsRoots);
    mbedtls_ctr_drbg_free(&tlsRandom);
    mbedtls_entropy_free(&tlsEntropy);
    tlsInitialized = false;
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

// HTTP field names are case-insensitive. Cloudflare currently emits
// "Sec-Websocket-Accept", while Node and other edges may emit
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
    if (!tlsInitialize()) return false;
    onlineProtocolStage = 2;
    if ((onlineTlsResult = mbedtls_ssl_session_reset(&tlsContext)) ||
        (onlineTlsResult = mbedtls_ssl_set_hostname(&tlsContext, serverHost))) return false;
    mbedtls_ssl_set_bio(&tlsContext, &onlineSocket, tlsSocketSend, tlsSocketReceive, NULL);

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
        else if (!strcmp(line, "page")) partyPage = !strcmp(equals, "party");
        else if (!strcmp(line, "dynarec")) dynarecEnabled = strcmp(equals, "disabled") != 0;
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

static void onlineDisconnect(void) {
    if (tlsActive) mbedtls_ssl_close_notify(&tlsContext);
    tlsActive = false;
    if (onlineSocket >= 0) close(onlineSocket);
    onlineSocket = -1;
    onlineMode = ONLINE_OFFLINE;
    remoteCount = 0;
    receiveLength = 0;
    webSocketLength = 0;
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

static void onlineConnected(void) {
    if (secureWebSocket && !startSecureWebSocket()) { debugNetworkFailure(); return onlineFail(EPROTO); }
    onlineMode = ONLINE_ACTIVE;
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
    nextReconnect = 0;
    onlineSocket = socket(AF_INET, SOCK_STREAM, 0);
    if (onlineSocket < 0) return onlineFail(errno);
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
    }
    address.sin_addr = serverAddress;
    int result = connect(onlineSocket, (sockaddr*) &address, sizeof(address));
    if (!result) onlineConnected();
    else if (errno == EINPROGRESS || errno == EWOULDBLOCK) {
        onlineMode = ONLINE_CONNECTING;
        connectStarted = osGetTime();
    } else onlineFail(errno);
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

static void parseOnlineLine(char* line) {
    if (jsonTypeIs(line, "enrolled") || jsonTypeIs(line, "identity_recovered")) {
        char id[37] = {}, token[65] = {}, credential[37] = {}, fingerprint[11] = {}, recovery[25] = {};
        if (!jsonString(line, "id", id, sizeof(id)) || !jsonString(line, "token", token, sizeof(token)) ||
            !jsonString(line, "credentialId", credential, sizeof(credential)) || !isHexString(token, 64)) return;
        strcpy(identityId, id);
        strcpy(identityToken, token);
        strcpy(credentialId, credential);
        if (jsonString(line, "fingerprint", fingerprint, sizeof(fingerprint))) strcpy(identityFingerprint, fingerprint);
        if (jsonString(line, "recoveryCode", recovery, sizeof(recovery))) strcpy(recoveryCode, recovery);
        if (!saveIdentity()) onlineLastError = EIO;
        return;
    }
    if (jsonTypeIs(line, "browser_pairing_approved")) {
        strcpy(browserPairingStatus, "BROWSER PAIRED");
        browserPairingStatusUntil = osGetTime() + 5000;
        return;
    }
    if (jsonTypeIs(line, "error")) {
        char code[40] = {};
        if (jsonString(line, "code", code, sizeof(code)) && strstr(code, "pairing")) {
            strcpy(browserPairingStatus, "PAIRING CODE EXPIRED");
            browserPairingStatusUntil = osGetTime() + 5000;
        }
        return;
    }
    if (jsonTypeIs(line, "chat")) {
        jsonString(line, "name", lastChatName, sizeof(lastChatName));
        jsonString(line, "text", lastChatText, sizeof(lastChatText));
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
        // the peer state detects that completed connection reliably.
        sockaddr_in peer = {};
        socklen_t peerSize = sizeof(peer);
        if (!getpeername(onlineSocket, (sockaddr*)&peer, &peerSize)) {
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
    SwkbdState keyboard;
    char text[81] = {};
    swkbdInit(&keyboard, SWKBD_TYPE_NORMAL, 2, 80);
    swkbdSetHintText(&keyboard, "Message trainers on this map");
    if (swkbdInputText(&keyboard, text, sizeof(text)) != SWKBD_BUTTON_CONFIRM || !text[0]) return;
    for (char* p = text; *p; ++p) if (*p == '"' || *p == '\\' || (unsigned char)*p < 0x20) *p = ' ';
    char packet[144];
    snprintf(packet, sizeof(packet), "{\"type\":\"chat\",\"text\":\"%s\"}\n", text);
    onlineSend(packet);
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

static void drawText(float x, float y, float size, uint32_t color, const char* format, ...) {
    char line[192];
    va_list args;
    va_start(args, format);
    vsnprintf(line, sizeof(line), format, args);
    va_end(args);
    C2D_Text text;
    if (uiFont) C2D_TextFontParse(&text, uiFont, textBuffer, line);
    else C2D_TextParse(&text, textBuffer, line);
    C2D_TextOptimize(&text);
    C2D_DrawText(&text, C2D_WithColor, x, y, 0.5f, size, size, color);
}

static char decodeEmerald(uint8_t value) {
    if (value >= 0xA1 && value <= 0xAA) return '0' + value - 0xA1;
    if (value >= 0xBB && value <= 0xD4) return 'A' + value - 0xBB;
    if (value >= 0xD5 && value <= 0xEE) return 'a' + value - 0xD5;
    return value == 0x00 ? ' ' : '?';
}

static void drawBottom(void) {
    C2D_TargetClear(bottomTarget, C2D_Color32(11, 36, 26, 255));
    C2D_SceneBegin(bottomTarget);
    C2D_DrawRectSolid(0, 0, 0, 320, 38, C2D_Color32(16, 45, 34, 255));
    C2D_DrawRectSolid(0, 36, 0, 320, 2, C2D_Color32(47, 184, 230, 255));
    C2D_TextBufClear(textBuffer);
    drawText(16, 11, .55f, C2D_Color32(255,255,255,255), partyPage ? "PARTY" : "EMERALD ONLINE");
    if (partyPage) {
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
        drawText(82, 222, .43f, C2D_Color32(190,220,210,255), "Y  ONLINE DASHBOARD");
        return;
    }
    const char* status = onlineMode == ONLINE_ACTIVE ? "ONLINE" : onlineMode == ONLINE_CONNECTING ? "CONNECTING" : onlineEnabled ? "RETRYING" : "OFFLINE";
    uint32_t statusColor = onlineMode == ONLINE_ACTIVE ? C2D_Color32(78,168,95,255) : onlineEnabled ? C2D_Color32(58,143,207,255) : C2D_Color32(77,80,96,255);
    C2D_DrawRectSolid(205, 7, 0, 103, 24, statusColor);
    drawText(225, 12, .42f, C2D_Color32(255,255,255,255), "%s", status);
    C2D_DrawRectSolid(10, 46, 0, 300, 43, C2D_Color32(25,74,54,255));
        drawText(20, 52, .43f, C2D_Color32(160,232,255,255), "%s", trainerName);
        if (identityFingerprint[0]) drawText(126, 52, .32f, C2D_Color32(185,215,205,255), "ID %s", identityFingerprint);
    drawText(250, 52, .43f, C2D_Color32(200,220,220,255), "%u FPS", measuredFps);
    if (presence.valid) drawText(20, 70, .38f, C2D_Color32(255,255,255,255), "MAP %u-%u   TILE %d,%d", presence.mapGroup, presence.mapNum, presence.x, presence.y);
    else drawText(20, 70, .38f, C2D_Color32(210,220,215,255), "Waiting for the overworld...");
        if (recoveryCode[0]) drawText(22, 91, .31f, C2D_Color32(255,220,130,255), "RECOVERY %s  WRITE THIS DOWN", recoveryCode);
        else if (browserPairingStatus[0] && osGetTime() < browserPairingStatusUntil) drawText(75, 91, .32f, C2D_Color32(255,220,130,255), "%s", browserPairingStatus);
        else if (onlineMode != ONLINE_ACTIVE) drawText(68, 91, .30f, C2D_Color32(180,205,200,255), "%s:%u E%d S%d", serverHost, serverPort, onlineLastError, onlineProtocolStage);
        else drawText(80, 91, .30f, C2D_Color32(180,205,200,255), "TAP PROFILE TO PAIR BROWSER");
    C2D_DrawRectSolid(10, 104, 0, 145, 90, C2D_Color32(22,61,46,255));
    C2D_DrawRectSolid(165, 104, 0, 145, 90, C2D_Color32(22,61,46,255));
    drawText(20, 110, .38f, C2D_Color32(160,232,255,255), "NEARBY  %d", remoteCount);
    for (int i = 0; i < remoteCount && i < 3; ++i) drawText(20, 130 + i * 17, .36f, C2D_Color32(255,255,255,255), "%.12s  %d,%d", remoteTrainers[i].name, remoteTrainers[i].x, remoteTrainers[i].y);
    if (!remoteCount) drawText(35, 145, .36f, C2D_Color32(180,205,200,255), "No trainers here");
    drawText(175, 110, .38f, C2D_Color32(160,232,255,255), "MAP CHAT");
    if (lastChatText[0]) {
        drawText(175, 130, .34f, C2D_Color32(160,232,255,255), "%.12s", lastChatName);
        drawText(175, 150, .32f, C2D_Color32(255,255,255,255), "%.20s", lastChatText);
        if (strlen(lastChatText) > 20) drawText(175, 168, .32f, C2D_Color32(255,255,255,255), "%.20s", lastChatText + 20);
    } else drawText(185, 145, .34f, C2D_Color32(180,205,200,255), "Tap to message");
    const uint32_t colors[4] = {C2D_Color32(41,93,66,255),C2D_Color32(66,80,165,255),C2D_Color32(58,118,80,255),C2D_Color32(98,87,46,255)};
    const char* labels[4] = {"WAVE","BATTLE","TRADE","GG"};
    for (int i = 0; i < 4; ++i) {
        C2D_DrawRectSolid(i * 81, 202, 0, i == 2 ? 77 : 78, 38, colors[i]);
        drawText(i * 81 + 17, 214, .36f, C2D_Color32(255,255,255,255), "%s", labels[i]);
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
    if (!presence.valid) return;
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
        loadConfig();
        loadIdentity();
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
        debugStage("save-loaded");
        if (onlineEnabled) onlineConnect();
        debugStage("online-started");
    }

    while (!quitRequested && aptMainLoop()) {
        hidScanInput();
        heldKeys = hidKeysHeld();
        uint32_t down = hidKeysDown();
        if (down & KEY_X) onlineToggle();
        if (down & KEY_Y) partyPage = !partyPage;
        if (down & KEY_TOUCH) {
            touchPosition touch;
            hidTouchRead(&touch);
            if (!partyPage && touch.py >= 202) sendEmote(touch.px / 81);
            else if (!partyPage && touch.py >= 46 && touch.py < 90) openBrowserPairing();
            else if (!partyPage && touch.px >= 165 && touch.py >= 104) openChat();
        }
        retro_run();
        static bool firstFrameLogged;
        if (!firstFrameLogged) { debugStage("first-frame"); firstFrameLogged = true; }
        presence = readPresence();
        updateTrainerNameFromSave();
        uint64_t now = osGetTime();
        if (now >= nextOnlinePoll) { nextOnlinePoll = now + 100; onlineUpdate(); }
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
    tlsFinalize();
    if (socBuffer) { socExit(); free(socBuffer); }
    return 0;
}
