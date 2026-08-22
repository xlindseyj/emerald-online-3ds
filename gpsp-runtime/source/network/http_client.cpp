#include "http_client.h"

#include <errno.h>
#include <fcntl.h>
#include <mbedtls/base64.h>
#include <mbedtls/ctr_drbg.h>
#include <mbedtls/entropy.h>
#include <mbedtls/net_sockets.h>
#include <mbedtls/sha1.h>
#include <mbedtls/sha256.h>
#include <mbedtls/ssl.h>
#include <mbedtls/x509_crt.h>
#include <arpa/inet.h>
#include <netdb.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#define APP_VERSION "0.8.10"

// The production endpoint uses Google Trust Services.
// Trust the long-lived issuing root, not a rotating leaf or intermediate.
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

// Updated by the certificate verify callback for diagnostics.
extern int onlineTlsFutureSkew;

mbedtls_entropy_context tlsEntropy;
mbedtls_ctr_drbg_context tlsRandom;
mbedtls_x509_crt tlsRoots;
mbedtls_ssl_config tlsConfig;
bool tlsInitialized = false;

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

int httpTlsSocketSend(void* context, const unsigned char* data, size_t size) {
    int socket = *(int*) context;
    ssize_t result = send(socket, data, size, MSG_NOSIGNAL);
    if (result >= 0) return (int) result;
    if (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR) return MBEDTLS_ERR_SSL_WANT_WRITE;
    return MBEDTLS_ERR_NET_SEND_FAILED;
}

int httpTlsSocketReceive(void* context, unsigned char* data, size_t size) {
    int socket = *(int*) context;
    ssize_t result = recv(socket, data, size, 0);
    if (result >= 0) return (int) result;
    if (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR) return MBEDTLS_ERR_SSL_WANT_READ;
    return MBEDTLS_ERR_NET_RECV_FAILED;
}

bool httpClientInit(void) {
    if (tlsInitialized) return true;
    mbedtls_entropy_init(&tlsEntropy);
    mbedtls_ctr_drbg_init(&tlsRandom);
    mbedtls_x509_crt_init(&tlsRoots);
    mbedtls_ssl_config_init(&tlsConfig);
    static const unsigned char personalization[] = "emerald-online-3ds";
    if (mbedtls_ctr_drbg_seed(&tlsRandom, mbedtls_entropy_func, &tlsEntropy, personalization, sizeof(personalization) - 1) ||
        mbedtls_x509_crt_parse(&tlsRoots, (const unsigned char*) GOOGLE_TRUST_SERVICES_ROOT_R4, sizeof(GOOGLE_TRUST_SERVICES_ROOT_R4)) ||
        mbedtls_ssl_config_defaults(&tlsConfig, MBEDTLS_SSL_IS_CLIENT, MBEDTLS_SSL_TRANSPORT_STREAM, MBEDTLS_SSL_PRESET_DEFAULT)) return false;
    mbedtls_ssl_conf_authmode(&tlsConfig, MBEDTLS_SSL_VERIFY_REQUIRED);
    mbedtls_ssl_conf_ca_chain(&tlsConfig, &tlsRoots, NULL);
    mbedtls_ssl_conf_verify(&tlsConfig, tlsVerifyCertificate, NULL);
    mbedtls_ssl_conf_rng(&tlsConfig, mbedtls_ctr_drbg_random, &tlsRandom);
    tlsInitialized = true;
    return true;
}

void httpClientShutdown(void) {
    if (!tlsInitialized) return;
    mbedtls_ssl_config_free(&tlsConfig);
    mbedtls_x509_crt_free(&tlsRoots);
    mbedtls_ctr_drbg_free(&tlsRandom);
    mbedtls_entropy_free(&tlsEntropy);
    tlsInitialized = false;
}

static bool mkdirs(const char* path) {
    char tmp[256];
    strncpy(tmp, path, sizeof(tmp) - 1);
    tmp[sizeof(tmp) - 1] = 0;
    for (char* p = tmp + 1; *p; ++p) {
        if (*p == '/') {
            *p = 0;
            mkdir(tmp, 0700);
            *p = '/';
        }
    }
    return mkdir(tmp, 0700) == 0 || errno == EEXIST;
}

static bool writeBytes(int socket, mbedtls_ssl_context* ssl, const unsigned char* data, size_t size) {
    size_t written = 0;
    unsigned waits = 0;
    while (written < size) {
        int count = ssl
            ? mbedtls_ssl_write(ssl, data + written, size - written)
            : (int) send(socket, data + written, size - written, MSG_NOSIGNAL);
        if (count > 0) { written += (size_t) count; waits = 0; continue; }
        if ((ssl && (count == MBEDTLS_ERR_SSL_WANT_READ || count == MBEDTLS_ERR_SSL_WANT_WRITE)) ||
            (!ssl && count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR))) {
            if (++waits > 250) return false;
            svcSleepThread(1000000);
            continue;
        }
        return false;
    }
    return true;
}

static int readBytes(int socket, mbedtls_ssl_context* ssl, unsigned char* data, size_t size, uint64_t deadline) {
    size_t read = 0;
    while (read < size && osGetTime() < deadline) {
        int count = ssl
            ? mbedtls_ssl_read(ssl, data + read, size - read)
            : (int) recv(socket, data + read, size - read, 0);
        if (count > 0) { read += (size_t) count; continue; }
        if ((ssl && (count == MBEDTLS_ERR_SSL_WANT_READ || count == MBEDTLS_ERR_SSL_WANT_WRITE)) ||
            (!ssl && count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR))) {
            svcSleepThread(1000000);
            continue;
        }
        return count == 0 ? (int) read : -1;
    }
    return (int) read;
}

static bool parseUrl(const char* url, char* host, size_t hostSize, char* path, size_t pathSize, bool* secure) {
    host[0] = path[0] = 0;
    *secure = true;
    const char* rest = url;
    if (strncmp(url, "https://", 8) == 0) {
        rest = url + 8;
    } else if (strncmp(url, "http://", 7) == 0) {
        rest = url + 7;
        *secure = false;
    }
    const char* slash = strchr(rest, '/');
    if (slash) {
        size_t hostLen = (size_t)(slash - rest);
        if (hostLen >= hostSize) return false;
        memcpy(host, rest, hostLen);
        host[hostLen] = 0;
        size_t pathLen = strlen(slash);
        if (pathLen >= pathSize) return false;
        memcpy(path, slash, pathLen + 1);
    } else {
        size_t hostLen = strlen(rest);
        if (hostLen >= hostSize) return false;
        memcpy(host, rest, hostLen + 1);
        path[0] = '/';
        path[1] = 0;
    }
    return host[0] != 0;
}

bool httpDownloadFile(const char* url, const char* outputPath,
                      uint64_t* outDownloaded, uint64_t* outTotal) {
    if (outDownloaded) *outDownloaded = 0;
    if (outTotal) *outTotal = 0;

    char host[128] = "";
    char path[256] = "";
    bool secure = true;
    if (!parseUrl(url, host, sizeof(host), path, sizeof(path), &secure)) return false;

    if (secure && !httpClientInit()) return false;

    int sock = socket(AF_INET, SOCK_STREAM, 0);
    if (sock < 0) return false;
    int flags = fcntl(sock, F_GETFL, 0);
    if (flags >= 0) fcntl(sock, F_SETFL, flags | O_NONBLOCK);

    struct hostent* he = gethostbyname(host);
    if (!he || !he->h_addr_list[0]) { close(sock); return false; }
    struct sockaddr_in addr = {};
    addr.sin_family = AF_INET;
    addr.sin_port = htons(secure ? 443 : 80);
    memcpy(&addr.sin_addr, he->h_addr_list[0], he->h_length);

    uint64_t connectDeadline = osGetTime() + 8000;
    while (connect(sock, (struct sockaddr*) &addr, sizeof(addr)) < 0) {
        if (errno != EINPROGRESS && errno != EALREADY && errno != EWOULDBLOCK) { close(sock); return false; }
        if (osGetTime() >= connectDeadline) { close(sock); return false; }
        svcSleepThread(1000000);
    }

    mbedtls_ssl_context ssl;
    mbedtls_ssl_init(&ssl);
    bool usingSsl = false;
    if (secure) {
        if (mbedtls_ssl_setup(&ssl, &tlsConfig) || mbedtls_ssl_set_hostname(&ssl, host)) {
            mbedtls_ssl_free(&ssl); close(sock); return false;
        }
        mbedtls_ssl_set_bio(&ssl, &sock, httpTlsSocketSend, httpTlsSocketReceive, NULL);

        uint64_t handshakeDeadline = osGetTime() + 8000;
        int result;
        while ((result = mbedtls_ssl_handshake(&ssl)) != 0) {
            if (result != MBEDTLS_ERR_SSL_WANT_READ && result != MBEDTLS_ERR_SSL_WANT_WRITE) {
                mbedtls_ssl_free(&ssl); close(sock); return false;
            }
            if (osGetTime() >= handshakeDeadline) { mbedtls_ssl_free(&ssl); close(sock); return false; }
            svcSleepThread(1000000);
        }
        if (mbedtls_ssl_get_verify_result(&ssl) != 0) { mbedtls_ssl_free(&ssl); close(sock); return false; }
        usingSsl = true;
    }

    char request[512];
    int requestLength = snprintf(request, sizeof(request),
        "GET %s HTTP/1.1\r\nHost: %s\r\nConnection: close\r\nUser-Agent: Emerald-Online-3DS/" APP_VERSION "\r\n\r\n",
        path, host);
    if (requestLength < 1 || !writeBytes(sock, usingSsl ? &ssl : NULL, (const unsigned char*) request, (size_t) requestLength)) {
        mbedtls_ssl_free(&ssl); close(sock); return false;
    }

    char response[4096];
    size_t responseLength = 0;
    uint64_t headerDeadline = osGetTime() + 8000;
    while (!strstr(response, "\r\n\r\n") && responseLength < sizeof(response) - 1 && osGetTime() < headerDeadline) {
        int got = readBytes(sock, usingSsl ? &ssl : NULL, (unsigned char*) response + responseLength, sizeof(response) - 1 - responseLength, headerDeadline);
        if (got <= 0) { mbedtls_ssl_free(&ssl); close(sock); return false; }
        responseLength += (size_t) got;
        response[responseLength] = 0;
    }
    if (strncmp(response, "HTTP/1.1 200", 12) && strncmp(response, "HTTP/1.0 200", 12)) {
        mbedtls_ssl_free(&ssl); close(sock); return false;
    }

    long long contentLength = -1;
    const char* cl = strstr(response, "Content-Length:");
    if (!cl) cl = strstr(response, "content-length:");
    if (cl) contentLength = strtoll(cl + 15, nullptr, 10);
    const char* body = strstr(response, "\r\n\r\n");
    if (!body) { mbedtls_ssl_free(&ssl); close(sock); return false; }
    body += 4;
    size_t bodyPrefix = responseLength - (size_t) (body - response);
    if (outTotal && contentLength > 0) *outTotal = (uint64_t) contentLength;

    if (!mkdirs(outputPath)) { mbedtls_ssl_free(&ssl); close(sock); return false; }
    FILE* file = fopen(outputPath, "wb");
    if (!file) { mbedtls_ssl_free(&ssl); close(sock); return false; }

    bool ok = true;
    if (bodyPrefix > 0) {
        if (fwrite(body, 1, bodyPrefix, file) != bodyPrefix) ok = false;
        if (outDownloaded) *outDownloaded += bodyPrefix;
    }

    uint64_t bodyDeadline = osGetTime() + 120000;
    uint8_t buffer[8192];
    while (ok) {
        int got = readBytes(sock, usingSsl ? &ssl : NULL, buffer, sizeof(buffer), bodyDeadline);
        if (got < 0) { ok = false; break; }
        if (got == 0) break;
        if (fwrite(buffer, 1, (size_t) got, file) != (size_t) got) ok = false;
        if (outDownloaded) *outDownloaded += (size_t) got;
    }
    if (fflush(file) || fsync(fileno(file))) ok = false;
    fclose(file);

    if (usingSsl) {
        mbedtls_ssl_close_notify(&ssl);
        mbedtls_ssl_free(&ssl);
    }
    close(sock);

    if (!ok) remove(outputPath);
    return ok;
}
