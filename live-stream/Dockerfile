# syntax=docker/dockerfile:1
# CricScore live-stream (Next.js 16 + Socket.IO custom server). Served under /stream by the API.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# .env is mounted only for this step (NEXT_PUBLIC_BASE_PATH etc. are baked into the build); it never lands in the image
RUN --mount=type=secret,id=dotenv,target=/app/.env \
    NODE_OPTIONS=--max-old-space-size=2048 npm run build

FROM node:22-alpine
# ffmpeg builds match highlights from the recordings
RUN apk add --no-cache ffmpeg
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 RECORDINGS_DIR=/app/recordings
COPY --from=build --chown=node:node /app/package.json /app/next.config.ts /app/tsconfig.json /app/server.ts ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/database ./database
COPY --from=build --chown=node:node /app/scripts ./scripts
RUN mkdir -p recordings && chown node:node recordings
USER node
EXPOSE 3300
# Settings come from /app/.env, which docker-compose.yml mounts read-only
CMD ["node_modules/.bin/tsx", "server.ts"]
