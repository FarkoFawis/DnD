# The whole app in one container: the server, with the built client inside it.
# Everything that must survive (database, uploaded pictures, private content packs)
# lives in /data, which the host mounts as a permanent disk. See docs/hosting.md.

# ---- build the client ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY tsconfig.base.json ./
COPY shared shared
COPY client client
RUN npm run build

# ---- the server ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/data/dnd.sqlite \
    UPLOADS_DIR=/data/uploads \
    CONTENT_DIR=/data/content
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace server --workspace shared && npm cache clean --force
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY --from=build /app/client/dist client/dist
# `dnd-users add Mira` etc. from the host's console, wherever that console starts.
COPY deploy/dnd-users /usr/local/bin/dnd-users
# (Windows checkouts can give the script CRLF line endings; a shell can't run those.)
RUN sed -i 's/\r$//' /usr/local/bin/dnd-users && chmod +x /usr/local/bin/dnd-users && mkdir -p /data
EXPOSE 8080
CMD ["node_modules/.bin/tsx", "--disable-warning=ExperimentalWarning", "server/src/index.ts"]
