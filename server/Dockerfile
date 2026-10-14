# Notionix collaboration server. Build from the repository root:
#   docker build -f server/Dockerfile -t notionix-server .
FROM node:22-alpine AS build
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci
COPY src/shared src/shared
COPY server server
RUN cd server && npm run build

FROM node:22-alpine
ENV NODE_ENV=production \
    NOTIONIX_HOST=0.0.0.0 \
    NOTIONIX_PORT=8080 \
    NOTIONIX_DATA_DIR=/data
WORKDIR /app
# One bundled file: no node_modules in the image.
COPY --from=build /app/server/dist/main.js ./main.js
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "main.js"]
