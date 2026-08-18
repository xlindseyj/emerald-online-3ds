#ifndef EMERALD_ONLINE_RUNTIME_LOG_H
#define EMERALD_ONLINE_RUNTIME_LOG_H

#include <3ds.h>
#include <stddef.h>

#define RUNTIME_LOG_RING_ENTRIES 64
#define RUNTIME_LOG_LINE_CHARS 128
#define RUNTIME_LOG_UPLOAD_LINES 8

bool runtimeLogInit(void);
void runtimeLogShutdown(void);
void runtimeLogPrintf(const char* fmt, ...) __attribute__((format(printf, 1, 2)));
unsigned runtimeLogGetRecent(char* out, size_t size, unsigned maxLines);
void runtimeLogUploadRecent(void);

#endif
