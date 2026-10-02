#!/bin/bash
# Deploys the CricScore API (with live streaming) to your server:
#   https://score.glamofashion.com   API, YouTube overlay, live streaming (/go, /watch)
#   https://db.glamofashion.com      phpMyAdmin (MySQL)
# Run from your Mac:   bash deploy/deploy.sh
# It asks for the server's root password once. Safe to run again for updates.
set -euo pipefail

HOST="${HOST:-root@187.126.117.103}"
DOMAIN="${DOMAIN:-score.glamofashion.com}"
DB_DOMAIN="${DB_DOMAIN:-db.glamofashion.com}"   # MySQL + phpMyAdmin; set DB_DOMAIN= to skip
APP_PORT="${APP_PORT:-3200}"

HERE="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$(cd "$HERE/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Database passwords: generated once, kept in deploy/.credentials (git-ignored, only you can read it)
CRED_FILE="$HERE/.credentials"
gen() { LC_ALL=C tr -dc 'A-Za-z0-9' < /dev/urandom | head -c 24; }
if [ ! -f "$CRED_FILE" ]; then
  umask 077
  cat > "$CRED_FILE" <<EOF
# CricScore server logins — keep private
PHPMYADMIN_URL=https://$DB_DOMAIN
WEB_USER=admin
WEB_PASS=$(gen)
PMA_USER=cricadmin
PMA_DB_PASS=$(gen)
APP_DB_PASS=$(gen)
EOF
  echo "🔐 Created $CRED_FILE"
fi
# shellcheck disable=SC1090
. "$CRED_FILE"

echo "📦 Packing the server code…"
COPYFILE_DISABLE=1 tar czf "$WORK/server.tgz" -C "$SERVER_DIR" index.js package.json package-lock.json src public

# One script carries the code + setup, so SSH asks for the password only once
{
  echo 'set -e'
  echo "base64 -d > /tmp/cricscore-server.tgz <<'B64'"
  base64 -i "$WORK/server.tgz"
  echo 'B64'
  echo "base64 -d > /tmp/cricscore-setup.sh <<'B64'"
  base64 -i "$HERE/remote-setup.sh"
  echo 'B64'
  printf "DOMAIN=%q APP_PORT=%q DB_DOMAIN=%q APP_DB_PASS=%q PMA_USER=%q PMA_DB_PASS=%q WEB_USER=%q WEB_PASS=%q bash /tmp/cricscore-setup.sh < /dev/null; rm -f /tmp/cricscore-setup.sh\n" \
    "$DOMAIN" "$APP_PORT" "$DB_DOMAIN" "$APP_DB_PASS" "$PMA_USER" "$PMA_DB_PASS" "$WEB_USER" "$WEB_PASS"
} > "$WORK/bundle.sh"

echo "🚀 Connecting to $HOST (enter the root password when asked)…"
# Output is also saved to deploy/last-deploy.log (passwords are not printed by the server)
LOG="$HERE/last-deploy.log"
echo "Started $(date)" > "$LOG"
set +e
ssh -o StrictHostKeyChecking=accept-new "$HOST" 'bash -s' < "$WORK/bundle.sh" 2>&1 | tee -a "$LOG"
STATUS=${PIPESTATUS[0]}
set -e
echo "Finished $(date) (exit $STATUS)" >> "$LOG"
[ "$STATUS" -eq 0 ] || { echo "✖ Deploy failed (exit $STATUS). Details saved in $LOG"; exit "$STATUS"; }

if [ -n "$DB_DOMAIN" ]; then
  echo ""
  echo "🔐 phpMyAdmin logins (also saved in $CRED_FILE):"
  echo "   1) Browser login at https://$DB_DOMAIN  ->  user: $WEB_USER   password: $WEB_PASS"
  echo "   2) phpMyAdmin login                     ->  user: $PMA_USER   password: $PMA_DB_PASS"
fi
