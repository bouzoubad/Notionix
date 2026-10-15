# Notionix server: web client, API and real-time sync in one image.
# Build from the repository root:
#   docker build -f server/Dockerfile -t notionix-server .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Only the build tools are needed here: no Electron download, no install scripts.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.node.json tsconfig.web.json web.vite.config.ts ./
COPY src src
COPY server server
RUN npm run build:server && npm run build:web

FROM node:22-alpine
ENV NODE_ENV=production \
    NOTIONIX_HOST=0.0.0.0 \
    NOTIONIX_PORT=8080 \
    NOTIONIX_DATA_DIR=/data
WORKDIR /app
# One bundled server file and the built web client: no node_modules in the image.
COPY --from=build /app/out/server/ ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "main.mjs"]
