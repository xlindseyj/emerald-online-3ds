FROM node:22-alpine

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
RUN npm ci --omit=dev && npm cache clean --force
COPY server/src ./server/src
COPY web/install-server.mjs ./web/install-server.mjs
COPY release/emerald-online-3ds.cia ./release/emerald-online-3ds.cia
COPY release/emerald-online-3ds.3dsx ./release/emerald-online-3ds.3dsx
COPY release/emerald-online-3ds-source-0.3.2.tar.gz ./release/emerald-online-3ds-source-0.3.2.tar.gz
COPY release/SHA256SUMS ./release/SHA256SUMS

USER node
EXPOSE 3210/tcp 3211/tcp 8080/tcp
CMD ["node", "server/src/server.mjs"]
