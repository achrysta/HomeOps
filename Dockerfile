# Базовый образ можно переопределить, например на зеркало реестра:
#   NODE_IMAGE=registry.example.com/library/node:24-alpine docker compose up -d --build
ARG NODE_IMAGE=node:24-alpine

# ── Build: проверки качества + production bundle ─────────────────────────────
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Сборка падает, если не проходят typecheck, lint или тесты
RUN npm run lint && npm test && npm run build

# ── Сервис стендов инцидентов: docker CLI + compose, управляет incidents/* через сокет Docker ──
FROM ${NODE_IMAGE} AS labs
# buildx: compose собирает образы стендов через BuildKit (TARGETARCH, общий кэш с хостом)
RUN apk add --no-cache docker-cli docker-cli-compose docker-cli-buildx
WORKDIR /app
ENV PORT=8090 \
    INCIDENTS_DIR=/workspace/incidents
COPY server/labs.ts server/labs-serve.ts server/websocket.ts server/requestGuards.ts ./server/
COPY scripts/gpuCapability.ts ./scripts/
EXPOSE 8090
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8090/healthz || exit 1
CMD ["node", "server/labs-serve.ts"]

# ── Runtime: статика + API файлового хранилища прогресса ─────────────────────
# Node 24 исполняет TypeScript (server/*.ts) без сборки; зависимостей у сервера нет.
FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    STATIC_DIR=/app/dist \
    DATA_DIR=/app/data
COPY --from=build /app/dist ./dist
COPY server/progressApi.ts server/incidentReports.ts server/contentIssues.ts server/serve.ts server/labsProxy.ts server/requestGuards.ts ./server/
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 8080
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
CMD ["node", "server/serve.ts"]
