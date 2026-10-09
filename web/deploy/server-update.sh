#!/bin/bash
# Puts the new code (website + API in one Next.js server) live on the VPS, without breaking anything:
#   1. Pulls github.com/ramkesh-bairwa/Team-score-api (main) into /var/www/cricscore-next.
#      The current setup in /var/www/cricscore (Docker API, live-stream, data, Nginx) is not touched.
#   2. Uses the current API's .env and data/, builds, and test-runs the new server on a spare port,
#      comparing its answers with the running API. Any difference -> stops, nothing is switched.
#   3. Switches: stops the Docker API container and runs the new server with systemd on the SAME port,
#      so Nginx needs no change. If the health check fails it starts the Docker API again.
# The live-stream container keeps running as it is.
#
# Run from your Mac:   bash web/deploy/server-update.sh      (asks for the server's root password once)
# If you changed an API response on purpose, skip the comparison:   SKIP_COMPARE=1 bash web/deploy/server-update.sh
set -euo pipefail
HOST="${HOST:-root@187.126.117.103}"
DOMAIN="${DOMAIN:-score.glamofashion.com}"
SSH="ssh -o StrictHostKeyChecking=accept-new"

$SSH "$HOST" "DOMAIN=$DOMAIN SKIP_COMPARE=${SKIP_COMPARE:-0} bash -s" <<'REMOTE'
set -euo pipefail
OLD=/var/www/cricscore
NEW=/var/www/cricscore-next
REPO=https://github.com/ramkesh-bairwa/Team-score-api.git
TEST_PORT=3299
say() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
fail() { echo "!!! $*" >&2; exit 1; }

say "Checking the current setup"
[ -f "$OLD/.env" ] || fail "$OLD/.env not found"
envval() { grep -E "^$1=" "$2" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r'; }
PORT=$(envval PORT "$OLD/.env"); PORT=${PORT:-3000}
curl -fs "http://127.0.0.1:$PORT/health" >/dev/null || fail "The current API does not answer on port $PORT"
echo "Current API answers on port $PORT: $(curl -fs http://127.0.0.1:$PORT/health)"
if systemctl is-active --quiet cricscore-next; then
  echo "(cricscore-next is already running — this is an update)"
elif ! docker ps --format '{{.Names}}' 2>/dev/null | grep -qx cricscore-api; then
  fail "Port $PORT is not served by the Docker container cricscore-api (maybe the old 'cricscore' systemd service?). Nothing changed — tell Claude."
fi

say "Getting the code"
command -v git >/dev/null || DEBIAN_FRONTEND=noninteractive apt-get install -y -qq git >/dev/null
if [ -d "$NEW/.git" ]; then
  git -C "$NEW" fetch -q origin main && git -C "$NEW" reset -q --hard origin/main
else
  git clone -q --branch main "$REPO" "$NEW"
fi
echo "commit $(git -C "$NEW" log --oneline -1)"

say "Node.js"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
fi
echo "node $(node -v)"

say "Settings: same .env and data as the current API"
cd "$NEW/web"
cp "$OLD/.env" .env
if [ "$(envval STORAGE .env)" != "mysql" ] && [ -z "$(envval DATA_DIR .env)" ]; then
  echo "DATA_DIR=$OLD/data" >> .env
fi
chmod 600 .env

say "Installing and building (the current API keeps serving)"
export NEXT_TELEMETRY_DISABLED=1
npm ci --no-audit --no-fund
NODE_OPTIONS=--max-old-space-size=1536 npm run build

say "Test run on port $TEST_PORT and comparing with the current API"
PORT=$TEST_PORT NODE_ENV=production nohup node_modules/.bin/tsx server.ts > /tmp/cricscore-next-test.log 2>&1 &
TEST_PID=$!
trap 'kill $TEST_PID 2>/dev/null || true' EXIT
for i in $(seq 1 60); do curl -fs -o /dev/null "http://127.0.0.1:$TEST_PORT/health" && break; sleep 1; done
diffs=0
for path in /health /api/shared-teams "/api/v2/matches?limit=20" /api/stream-ice /api/live/ZZZZZZ/overlay /api/nope; do
  a=$(curl -s -w ' [%{http_code}]' "http://127.0.0.1:$PORT$path")
  b=$(curl -s -w ' [%{http_code}]' "http://127.0.0.1:$TEST_PORT$path")
  if [ "$a" = "$b" ]; then echo "  same  $path"; else echo "  DIFF  $path"; echo "    old: ${a:0:200}"; echo "    new: ${b:0:200}"; diffs=$((diffs+1)); fi
done
kill $TEST_PID 2>/dev/null || true; trap - EXIT
[ $diffs = 0 ] || [ "${SKIP_COMPARE:-0}" = 1 ] || { tail -20 /tmp/cricscore-next-test.log; fail "New server answers differently — nothing was switched. The current API is still running."; }

say "systemd service cricscore-next (port $PORT)"
cat > /etc/systemd/system/cricscore-next.service <<UNIT
[Unit]
Description=CricScore (website + API, Next.js)
After=network.target mysql.service

[Service]
WorkingDirectory=$NEW/web
Environment=NODE_ENV=production
Environment=NEXT_TELEMETRY_DISABLED=1
ExecStart=$NEW/web/node_modules/.bin/tsx server.ts
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload

rollback() {
  echo "!!! New server did not come up — starting the old Docker API again" >&2
  journalctl -u cricscore-next -n 30 --no-pager || true
  systemctl disable --now cricscore-next || true
  docker update --restart=unless-stopped cricscore-api >/dev/null 2>&1 || true
  docker start cricscore-api
  exit 1
}

say "Switching (a few seconds of downtime)"
if docker ps --format '{{.Names}}' 2>/dev/null | grep -qx cricscore-api; then
  docker update --restart=no cricscore-api >/dev/null
  docker stop cricscore-api >/dev/null
fi
systemctl enable cricscore-next >/dev/null 2>&1
systemctl restart cricscore-next
ok=0
for i in $(seq 1 60); do curl -fs -o /dev/null "http://127.0.0.1:$PORT/health" && { ok=1; break; }; sleep 1; done
[ $ok = 1 ] || rollback
curl -fs -o /dev/null "https://$DOMAIN/health" || rollback

say "Live"
echo "  https://$DOMAIN/health -> $(curl -fs https://$DOMAIN/health)"
echo "  website / -> HTTP $(curl -s -o /dev/null -w '%{http_code}' https://$DOMAIN/)"
echo "  live-stream (Docker, unchanged): $(docker ps --format '{{.Names}} {{.Status}}' | grep cricscore-live-stream || echo 'not running')"
echo
echo "  Logs:      journalctl -u cricscore-next -f"
echo "  Go back:   systemctl disable --now cricscore-next && docker update --restart=unless-stopped cricscore-api && docker start cricscore-api"
REMOTE
