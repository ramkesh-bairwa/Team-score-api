#!/bin/bash
# Deploys the CricScore website to the VPS:
#   code -> /var/www/cricscore-web, built there with Node, run by systemd (service "cricscore-web", port 3400),
#   and Nginx sends https://score.glamofashion.com/ to it. API paths (/api, /stream, /overlay, /go, /watch,
#   /rtc, /health, /docs) keep going to the API on port 3200; the API itself is not touched or restarted.
# Run from your Mac:   bash deploy/deploy.sh      (asks for the server's root password once)
set -euo pipefail

HOST="${HOST:-root@187.126.117.103}"
APP_DIR="${APP_DIR:-/var/www/cricscore-web}"
DOMAIN="${DOMAIN:-score.glamofashion.com}"
WEB_PORT=3400

cd "$(dirname "$0")/.."
SSH="ssh -o StrictHostKeyChecking=accept-new -o ControlMaster=auto -o ControlPath=/tmp/cricscore-web-%r@%h -o ControlPersist=300"

echo "📦 Uploading website to $HOST:$APP_DIR…"
$SSH "$HOST" "mkdir -p $APP_DIR"
rsync -az --delete -e "$SSH" \
  --exclude .git/ --exclude node_modules/ --exclude .next/ --exclude '.env*' --exclude .DS_Store --exclude '*.tsbuildinfo' \
  ./ "$HOST:$APP_DIR/"

echo "🔨 Building on the server and (re)starting the service…"
$SSH "$HOST" "APP_DIR=$APP_DIR WEB_PORT=$WEB_PORT bash $APP_DIR/deploy/remote-build.sh"

echo "🌐 Routing / to the website (API paths stay on the API)…"
$SSH "$HOST" "bash $APP_DIR/deploy/nginx-web.sh"

echo "🔎 Checking https://$DOMAIN"
curl -fsS -o /dev/null -w "  website  /        %{http_code}\n" "https://$DOMAIN/"
curl -fsS -w "  api      /health  %{http_code}  " "https://$DOMAIN/health"; echo
echo "✅ Website live at https://$DOMAIN"
echo "   Logs:    ssh $HOST journalctl -u cricscore-web -f"
