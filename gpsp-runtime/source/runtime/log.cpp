#include "log.h"

#include "ui/pages.h"

#include <stdarg.h>
#include <stdio.h>
#include <string.h>

extern bool onlineSend(const char* message);

struct LogEntry {
    uint64_t timestamp;
    char line[RUNTIME_LOG_LINE_CHARS];
};

static LogEntry ringBuffer[RUNTIME_LOG_RING_ENTRIES];
static unsigned ringWriteIndex = 0;
static unsigned ringCount = 0;
static LightLock ringLock;
static bool initialized = false;

bool runtimeLogInit(void) {
    LightLock_Init(&ringLock);
    ringWriteIndex = 0;
    ringCount = 0;
    memset(ringBuffer, 0, sizeof(ringBuffer));
    initialized = true;
    return true;
}

void runtimeLogShutdown(void) {
    initialized = false;
    ringWriteIndex = 0;
    ringCount = 0;
}

void runtimeLogPrintf(const char* fmt, ...) {
    if (!initialized || !fmt) return;
    char temp[RUNTIME_LOG_LINE_CHARS];
    va_list args;
    va_start(args, fmt);
    vsnprintf(temp, sizeof(temp), fmt, args);
    va_end(args);

    LightLock_Lock(&ringLock);
    LogEntry* entry = &ringBuffer[ringWriteIndex];
    entry->timestamp = osGetTime();
    strncpy(entry->line, temp, sizeof(entry->line) - 1);
    entry->line[sizeof(entry->line) - 1] = 0;
    ringWriteIndex = (ringWriteIndex + 1) % RUNTIME_LOG_RING_ENTRIES;
    if (ringCount < RUNTIME_LOG_RING_ENTRIES) ++ringCount;
    LightLock_Unlock(&ringLock);
}

unsigned runtimeLogGetRecent(char* out, size_t size, unsigned maxLines) {
    if (!out || !size) return 0;
    out[0] = 0;
    if (!initialized || !ringCount || !maxLines) return 0;

    LightLock_Lock(&ringLock);
    unsigned count = ringCount < maxLines ? ringCount : maxLines;
    size_t offset = 0;
    for (unsigned i = 0; i < count; ++i) {
        unsigned index = (ringWriteIndex + RUNTIME_LOG_RING_ENTRIES - 1 - i) % RUNTIME_LOG_RING_ENTRIES;
        const LogEntry* entry = &ringBuffer[index];
        int written = snprintf(out + offset, size - offset, "%llu %s\n",
            (unsigned long long) entry->timestamp, entry->line);
        if (written < 0 || (size_t) written >= size - offset) {
            out[offset] = 0;
            break;
        }
        offset += (size_t) written;
    }
    LightLock_Unlock(&ringLock);
    return count;
}

void runtimeLogUploadRecent(void) {
    if (onlineMode != ONLINE_ACTIVE || !statsEnabled) return;
    char lines[RUNTIME_LOG_UPLOAD_LINES][RUNTIME_LOG_LINE_CHARS];
    char buffer[RUNTIME_LOG_UPLOAD_LINES * (RUNTIME_LOG_LINE_CHARS + 32)];
    buffer[0] = 0;

    LightLock_Lock(&ringLock);
    unsigned count = ringCount < RUNTIME_LOG_UPLOAD_LINES ? ringCount : RUNTIME_LOG_UPLOAD_LINES;
    for (unsigned i = 0; i < count; ++i) {
        unsigned index = (ringWriteIndex + RUNTIME_LOG_RING_ENTRIES - 1 - i) % RUNTIME_LOG_RING_ENTRIES;
        strncpy(lines[i], ringBuffer[index].line, sizeof(lines[i]) - 1);
        lines[i][sizeof(lines[i]) - 1] = 0;
    }
    LightLock_Unlock(&ringLock);

    if (!count) return;
    size_t length = 0;
    length += snprintf(buffer + length, sizeof(buffer) - length, "{\"type\":\"telemetry\",\"lines\":[");
    for (unsigned i = 0; i < count; ++i) {
        if (i) length += snprintf(buffer + length, sizeof(buffer) - length, ",");
        length += snprintf(buffer + length, sizeof(buffer) - length, "\"");
        for (const char* at = lines[count - 1 - i]; *at && length + 1 < sizeof(buffer); ++at) {
            if (*at == '"' || *at == '\\') buffer[length++] = '\\';
            buffer[length++] = *at;
        }
        if (length < sizeof(buffer)) length += snprintf(buffer + length, sizeof(buffer) - length, "\"");
    }
    if (length < sizeof(buffer)) length += snprintf(buffer + length, sizeof(buffer) - length, "]}\n");
    if (length < sizeof(buffer)) {
        buffer[length] = 0;
        onlineSend(buffer);
    }
}
