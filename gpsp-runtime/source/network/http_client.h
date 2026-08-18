#ifndef EMERALD_ONLINE_HTTP_CLIENT_H
#define EMERALD_ONLINE_HTTP_CLIENT_H

#include <3ds.h>
#include <mbedtls/ssl.h>
#include <mbedtls/ctr_drbg.h>
#include <mbedtls/x509_crt.h>

// Shared TLS state for WebSocket reuse.
extern mbedtls_ctr_drbg_context tlsRandom;
extern mbedtls_ssl_config tlsConfig;
extern mbedtls_x509_crt tlsRoots;
extern bool tlsInitialized;

// Initialize/shutdown the shared TLS stack.
bool httpClientInit(void);
void httpClientShutdown(void);

// TLS socket callbacks for WebSocket reuse.
int httpTlsSocketSend(void* context, const unsigned char* data, size_t size);
int httpTlsSocketReceive(void* context, unsigned char* data, size_t size);

// Download a file over HTTPS (or plain HTTP) to outputPath.
// outDownloaded and outTotal may be NULL.
bool httpDownloadFile(const char* url, const char* outputPath,
                      uint64_t* outDownloaded, uint64_t* outTotal);

#endif
