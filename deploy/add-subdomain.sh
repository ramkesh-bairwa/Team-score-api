#!/bin/bash
# Creates https://<name>.glamofashion.com on your server and connects it to a project.
#
#   bash add-subdomain.sh <name> proxy  <port>                          app already running on the server
#   bash add-subdomain.sh <name> static <local-folder>                  website / React build folder
#   bash add-subdomain.sh <name> node   <local-folder> <port> ["cmd"]   Node.js project (default cmd: npm start)
#
# Examples:
#   bash add-subdomain.sh shop   static ~/Projects/shop/build
#   bash add-subdomain.sh api2   node   ~/Projects/api2 3300
#   bash add-subdomain.sh admin  proxy  4000
#
# DNS: creates the A record automatically if HOSTINGER_API_TOKEN is set (hPanel → Account → API),
# otherwise it checks the record exists (add it in hPanel → Domains → DNS, or ask Claude).
# Asks for the server's root password once. Re-run any time to update the project.
set -euo pipefail

HOST="${HOST:-root@187.126.117.103}"
SERVER_IP="${SERVER_IP:-187.126.117.103}"
DOMAIN="${DOMAIN:-glamofashion.com}"
HERE="$(cd "$(dirname "$0")" && pwd)"

usage() { sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
[ $# -ge 3 ] || usage
SUB="$1"; MODE="$2"
[[ "$SUB" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || { echo "Subdomain must be lowercase letters, numbers and dashes"; exit 1; }
case "$SUB" in score|db|www) echo "'$SUB' is already used"; exit 1 ;; esac
FQDN="$SUB.$DOMAIN"
PORT=""; SRC=""; START_CMD="${5:-}"
case "$MODE" in
  proxy)  PORT="$3" ;;
  static) SRC="$3" ;;
  node)   SRC="$3"; PORT="${4:-}"; [ -n "$PORT" ] || usage ;;
  *) usage ;;
esac
if [ -n "$PORT" ]; then
  [[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || { echo "Port must be 1024-65535"; exit 1; }
  case "$PORT" in 3200|3306) echo "Port $PORT is used by CricScore/MySQL, pick another"; exit 1 ;; esac
fi
if [ -n "$SRC" ]; then
  SRC="$(cd "$SRC" && pwd)" || { echo "Folder not found: $3"; exit 1; }
  [ "$MODE" != node ] || [ -f "$SRC/package.json" ] || { echo "No package.json in $SRC"; exit 1; }
fi

echo "🌐 $FQDN → $MODE ${PORT:+(port $PORT)} ${SRC:+($SRC)}"

# 1) DNS record
current="$(dig +short "$FQDN" A @1.1.1.1 | tail -1)"
if [ "$current" != "$SERVER_IP" ]; then
  if [ -n "${HOSTINGER_API_TOKEN:-}" ]; then
    echo "📡 Creating DNS record $FQDN → $SERVER_IP"
    curl -fsS -X PUT "https://developers.hostinger.com/api/dns/v1/zones/$DOMAIN" \
      -H "Authorization: Bearer $HOSTINGER_API_TOKEN" -H "Content-Type: application/json" \
      -d "{\"overwrite\":true,\"zone\":[{\"name\":\"$SUB\",\"type\":\"A\",\"ttl\":300,\"records\":[{\"content\":\"$SERVER_IP\"}]}]}" >/dev/null
    for _ in $(seq 1 24); do [ "$(dig +short "$FQDN" A @1.1.1.1 | tail -1)" = "$SERVER_IP" ] && break; sleep 5; done
  fi
  if [ "$(dig +short "$FQDN" A @1.1.1.1 | tail -1)" != "$SERVER_IP" ]; then
    echo "✖ $FQDN does not point to $SERVER_IP yet."
    echo "  Add an A record: name '$SUB' → $SERVER_IP (hPanel → Domains → $DOMAIN → DNS), wait a minute, run again."
    exit 1
  fi
fi
echo "✓ DNS ok"

# 2) Pack the project (if any) + server script into one bundle → one SSH login
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
{
  echo 'set -e'
  if [ -n "$SRC" ]; then
    echo "📦 Packing ${SRC}…" >&2
    COPYFILE_DISABLE=1 tar czf "$WORK/files.tgz" -C "$SRC" --exclude node_modules --exclude .git --exclude .env --exclude '.DS_Store' .
    echo "base64 -d > /tmp/subdomain-files.tgz <<'B64'"; base64 -i "$WORK/files.tgz"; echo 'B64'
  fi
  echo "base64 -d > /tmp/remote-subdomain.sh <<'B64'"; base64 -i "$HERE/remote-subdomain.sh"; echo 'B64'
  printf "FQDN=%q MODE=%q SUB=%q PORT=%q START_CMD=%q bash /tmp/remote-subdomain.sh < /dev/null; rm -f /tmp/remote-subdomain.sh\n" \
    "$FQDN" "$MODE" "$SUB" "$PORT" "$START_CMD"
} > "$WORK/bundle.sh"

echo "🚀 Connecting to $HOST (enter the root password when asked)…"
ssh -o StrictHostKeyChecking=accept-new "$HOST" 'bash -s' < "$WORK/bundle.sh"
