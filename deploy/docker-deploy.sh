#!/bin/bash
# Deploys CricScore (API + live-stream) to the VPS with Docker:
#   https://score.glamofashion.com   API (container cricscore-api, port 3200)
#   https://score.glamofashion.com/stream   live-stream (container cricscore-live-stream, port 3300)
# Run from your Mac:   bash deploy/docker-deploy.sh
# It asks for the server's root password once. The server keeps its own .env, live-stream/.env,
# data/, logs/ and live-stream/recordings/ — they are never uploaded or deleted.
set -euo pipefail

HOST="${HOST:-root@187.126.117.103}"
APP_DIR="${APP_DIR:-/var/www/cricscore}"

cd "$(dirname "$0")/.."
# One SSH connection for rsync and the remote commands, so the password is asked once
SSH="ssh -o StrictHostKeyChecking=accept-new -o ControlMaster=auto -o ControlPath=/tmp/cricscore-deploy-%r@%h -o ControlPersist=120"

echo "📦 Uploading code to $HOST:$APP_DIR…"
rsync -az --delete -e "$SSH" \
  --exclude .git/ --exclude node_modules/ --exclude .next/ \
  --exclude .env --exclude .env.local --exclude data/ --exclude logs/ \
  --exclude live-stream/recordings/ --exclude live-stream/.mysql/ \
  --exclude deploy/.credentials --exclude deploy/last-deploy.log --exclude '*.tsbuildinfo' --exclude .DS_Store \
  ./ "$HOST:$APP_DIR/"

echo "🐳 Building and restarting containers…"
$SSH "$HOST" "cd $APP_DIR && docker compose up -d --build && docker image prune -f >/dev/null && docker compose ps"

echo "✅ Deployed: https://score.glamofashion.com"
