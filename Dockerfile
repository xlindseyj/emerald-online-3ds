# syntax=docker/dockerfile:1.7
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32

ENV NODE_ENV=production \
    GAME_HOST=0.0.0.0 \
    GAME_PORT=3210 \
    HEALTH_PORT=3211 \
    IDLE_MS=30000 \
    MAX_CONNECTIONS=64 \
    MAX_CONNECTIONS_PER_IP=8 \
    HELLO_TIMEOUT_MS=5000

WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm,sharing=locked npm ci --omit=dev --no-audit --no-fund
COPY server/src ./server/src
COPY server/migrations ./server/migrations
COPY server/tools ./server/tools
COPY web ./web
COPY assets/emerald-online-3ds-icon.png ./assets/emerald-online-3ds-icon.png
COPY assets/emerald-online-3ds-web-logo.png ./assets/emerald-online-3ds-web-logo.png
COPY assets/release-media ./assets/release-media
COPY release/emerald-online-3ds.cia ./release/emerald-online-3ds.cia
COPY release/emerald-online-3ds.3dsx ./release/emerald-online-3ds.3dsx
COPY release/emerald-online-3ds-source-*.tar.gz ./release/
COPY release/emerald-online-3ds.unistore ./release/emerald-online-3ds.unistore
COPY release/SHA256SUMS ./release/SHA256SUMS
COPY release/release-catalog.json ./release/release-catalog.json
COPY release/known-issues.json ./release/known-issues.json
COPY release/community-pages.json ./release/community-pages.json

USER node
EXPOSE 3210/tcp 3211/tcp 8080/tcp
CMD ["node", "server/src/server.mjs"]
