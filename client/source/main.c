#include <3ds.h>
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <malloc.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "config.h"

typedef enum { MODE_OFFLINE, MODE_CONNECTING, MODE_ONLINE } NetMode;
typedef struct { int x, y; unsigned seq; const char *facing; } Player;
typedef struct { char name[13]; int x, y; } RemotePlayer;
static int sock = -1; static NetMode mode = MODE_OFFLINE;
static RemotePlayer remotes[8]; static int remoteCount = 0;
static char receiveBuffer[4097]; static size_t receiveLength = 0;

static void disconnect_server(void) {
  if (sock >= 0) close(sock);
  sock = -1; mode = MODE_OFFLINE; remoteCount = 0; receiveLength = 0;
}
static void connect_server(void) {
  disconnect_server(); mode = MODE_CONNECTING; sock = socket(AF_INET, SOCK_STREAM, 0);
  struct sockaddr_in addr = { .sin_family = AF_INET, .sin_port = htons(GAME_SERVER_PORT) };
  if (sock < 0 || inet_pton(AF_INET, GAME_SERVER_HOST, &addr.sin_addr) != 1 || connect(sock, (struct sockaddr*)&addr, sizeof(addr)) < 0) { disconnect_server(); return; }
  char hello[96]; int n = snprintf(hello, sizeof hello, "{\"type\":\"hello\",\"version\":1,\"name\":\"%s\"}\n", TRAINER_NAME);
  if (send(sock, hello, n, 0) != n) { disconnect_server(); return; }
  fcntl(sock, F_SETFL, fcntl(sock, F_GETFL, 0) | O_NONBLOCK); mode = MODE_ONLINE;
}
static void send_state(Player *p) {
  if (mode != MODE_ONLINE) return;
  char line[160];
  int n = snprintf(line, sizeof line, "{\"type\":\"state\",\"seq\":%u,\"map\":\"prototype\",\"x\":%d,\"y\":%d,\"facing\":\"%s\"}\n", ++p->seq, p->x, p->y, p->facing);
  if (send(sock, line, n, MSG_NOSIGNAL) < 0 && errno != EWOULDBLOCK) disconnect_server();
}

static void parse_snapshot(char *line) {
  if (!strstr(line, "\"type\":\"snapshot\"")) return;
  remoteCount = 0;
  char *cursor = strstr(line, "\"players\":[");
  if (!cursor) return;
  while (remoteCount < 8 && (cursor = strstr(cursor, "\"name\":\""))) {
    cursor += 8; char *end = strchr(cursor, '"'); if (!end) break;
    size_t nameLength = (size_t)(end - cursor); if (nameLength > 12) nameLength = 12;
    memcpy(remotes[remoteCount].name, cursor, nameLength); remotes[remoteCount].name[nameLength] = '\0';
    char *x = strstr(end, "\"x\":"); char *y = strstr(end, "\"y\":"); if (!x || !y) break;
    remotes[remoteCount].x = (int)strtol(x + 4, NULL, 10); remotes[remoteCount].y = (int)strtol(y + 4, NULL, 10);
    remoteCount++; cursor = y + 4;
  }
}

static void receive_network(void) {
  if (mode != MODE_ONLINE) return;
  for (;;) {
    ssize_t count = recv(sock, receiveBuffer + receiveLength, sizeof receiveBuffer - 1 - receiveLength, 0);
    if (count == 0) { disconnect_server(); return; }
    if (count < 0) { if (errno == EWOULDBLOCK || errno == EAGAIN) return; disconnect_server(); return; }
    receiveLength += (size_t)count; receiveBuffer[receiveLength] = '\0';
    char *newline;
    while ((newline = memchr(receiveBuffer, '\n', receiveLength))) {
      size_t lineLength = (size_t)(newline - receiveBuffer); *newline = '\0'; parse_snapshot(receiveBuffer);
      size_t consumed = lineLength + 1; memmove(receiveBuffer, receiveBuffer + consumed, receiveLength - consumed);
      receiveLength -= consumed; receiveBuffer[receiveLength] = '\0';
    }
    if (receiveLength == sizeof receiveBuffer - 1) { disconnect_server(); return; }
  }
}

int main(void) {
  gfxInitDefault(); PrintConsole top, bottom; consoleInit(GFX_TOP, &top); consoleInit(GFX_BOTTOM, &bottom);
  u32 *socBuffer = (u32*)memalign(0x1000, 0x100000); socInit(socBuffer, 0x100000); Player p = { 20, 12, 0, "down" };
  while (aptMainLoop()) {
    hidScanInput(); u32 down = hidKeysDown(); if (down & KEY_START) break;
    if (down & KEY_X) { if (mode == MODE_OFFLINE) connect_server(); else disconnect_server(); }
    int ox = p.x, oy = p.y;
    if (down & KEY_UP) { p.y--; p.facing = "up"; }
    if (down & KEY_DOWN) { p.y++; p.facing = "down"; }
    if (down & KEY_LEFT) { p.x--; p.facing = "left"; }
    if (down & KEY_RIGHT) { p.x++; p.facing = "right"; }
    if (p.x < 0) p.x = 0;
    if (p.y < 0) p.y = 0;
    if (p.x > 99) p.x = 99;
    if (p.y > 99) p.y = 99;
    if (p.x != ox || p.y != oy) send_state(&p);
    receive_network();
    consoleSelect(&top); consoleClear(); printf("OVERWORLD (clean-room prototype)\n\n             map: prototype\n\n                  @  You\n\n        Trainer at tile %d, %d\n\n", p.x, p.y);
    for (int i = 0; i < remoteCount; i++) printf("        + %-12s at %d, %d\n", remotes[i].name, remotes[i].x, remotes[i].y);
    consoleSelect(&bottom); consoleClear(); printf("TRAINER PANEL\n\nPosition: %d, %d\nFacing: %s\nMode: %s\nNearby trainers: %d\n\nD-pad: move\nX: toggle online\nSTART: exit", p.x, p.y, p.facing, mode == MODE_ONLINE ? "ONLINE" : mode == MODE_CONNECTING ? "CONNECTING" : "OFFLINE", remoteCount);
    gfxFlushBuffers(); gfxSwapBuffers(); gspWaitForVBlank();
  }
  disconnect_server(); socExit(); free(socBuffer); gfxExit(); return 0;
}
