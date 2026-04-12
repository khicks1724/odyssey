FROM node:22-bookworm-slim AS client-builder
WORKDIR /app/client
ARG VITE_APP_BASE_PATH=/
COPY client/package*.json ./
RUN npm ci --legacy-peer-deps
COPY client/ ./
ENV VITE_APP_BASE_PATH=${VITE_APP_BASE_PATH}
RUN npx vite build

FROM node:22-bookworm-slim AS server-builder
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --legacy-peer-deps
COPY server/ ./
RUN npm run build

FROM node:22-bookworm-slim AS server-deps
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ARG TECTONIC_VERSION=0.15.0
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
  && rm -rf /var/lib/apt/lists/*
RUN curl -L -o /tmp/tectonic.tar.gz "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-x86_64-unknown-linux-musl.tar.gz" \
  && tar -xzf /tmp/tectonic.tar.gz -C /usr/local/bin tectonic \
  && chmod +x /usr/local/bin/tectonic \
  && rm -f /tmp/tectonic.tar.gz
COPY --from=server-deps /app/server/node_modules /app/server/node_modules
COPY --from=server-builder /app/server/dist /app/server/dist
COPY --from=client-builder /app/client/dist /app/client-dist
COPY deploy/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "/app/server/dist/index.js"]
