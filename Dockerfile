# CricScore API (Express + Socket.IO). Built and run by docker-compose.yml.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY index.js ./
COPY src ./src
COPY public ./public
RUN mkdir -p data logs && chown -R node:node data logs
USER node
EXPOSE 3200
# Settings come from /app/.env, which docker-compose.yml mounts read-only
CMD ["node", "index.js"]
