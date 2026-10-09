#!/bin/bash
# Runs ON THE SERVER (deploy.sh calls it). Makes https://$DOMAIN/ show the website while every API path
# keeps going to the CricScore API exactly as before:
#   /api /health /overlay /go /watch /stream /rtc /socket.io /docs /openapi.json  -> the API (address read from Nginx)
#   everything else                                                               -> 127.0.0.1:$WEB_PORT (website)
# Finds the Nginx site for $DOMAIN and the API's current address itself. Safe to re-run.
# Backs up the site file and restores it if `nginx -t` fails.
set -euo pipefail
DOMAIN="${DOMAIN:-score.glamofashion.com}"
WEB_PORT="${WEB_PORT:-3400}"
WEB="http://127.0.0.1:$WEB_PORT"
SNIPPET=/etc/nginx/snippets/cricscore-api.conf

# 1) The enabled site that serves $DOMAIN
SITE=""
for f in /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf; do
  [ -e "$f" ] || continue
  if grep -qE "server_name[^;]*[[:space:]]$DOMAIN([[:space:]]|;)" "$f"; then SITE="$(readlink -f "$f")"; break; fi
done
[ -n "$SITE" ] || { echo "No Nginx site with server_name $DOMAIN found" >&2; exit 1; }
echo "Nginx site: $SITE"

# 2) Where the API is today: proxy_pass of "location /" (or the snippet, if this already ran before)
API=$(python3 - "$SITE" "$WEB" <<'PY'
import re, sys
s = open(sys.argv[1]).read()
for m in re.finditer(r"location / \{[^}]*?proxy_pass\s+([^;\s]+);", s):
    if m.group(1).rstrip('/') != sys.argv[2]:
        print(m.group(1).rstrip('/')); break
PY
)
if [ -z "$API" ] && [ -f "$SNIPPET" ]; then
  API=$(grep -oE 'proxy_pass[[:space:]]+[^;]+' "$SNIPPET" | awk '{print $2}' | head -1)
fi
[ -n "$API" ] || { echo "Could not find the API address in $SITE" >&2; exit 1; }
echo "API address: $API   website: $WEB"
curl -fs -o /dev/null "$API/health" || { echo "API does not answer at $API/health — not changing Nginx" >&2; exit 1; }
curl -fs -o /dev/null "$WEB/" || { echo "Website does not answer at $WEB — not changing Nginx" >&2; exit 1; }

mkdir -p /etc/nginx/snippets
cat > "$SNIPPET" <<CONF
# CricScore API paths (managed by cricscore-web/deploy/nginx-web.sh)
location ~ ^/(api|health|overlay|go|watch|stream|rtc|socket\.io|docs|openapi\.json)(/|\$) {
    proxy_pass $API;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 300s;
    client_max_body_size 20m;
}
CONF

BACKUP="/root/nginx-backup-$(basename "$SITE")-$(date +%Y%m%d%H%M%S)"
cp "$SITE" "$BACKUP"

python3 - "$SITE" "$API" "$WEB" "$SNIPPET" <<'PY'
import re, sys
path, api, web, snippet = sys.argv[1:]
s = open(path).read()
include = f"include {snippet};"
if include not in s:
    s = re.sub(r"\n([ \t]*)location / \{", lambda m: f"\n{m.group(1)}{include}{m.group(0)}", s)
s = re.sub(r"(location / \{[^}]*?proxy_pass\s+)%s/?;" % re.escape(api), r"\g<1>%s;" % web, s)
open(path, "w").write(s)
PY

if nginx -t 2>/dev/null; then
  systemctl reload nginx
  echo "Nginx: / -> website $WEB, API paths -> $API (backup: $BACKUP)"
else
  cp "$BACKUP" "$SITE"
  nginx -t && systemctl reload nginx
  echo "!!! New Nginx config was invalid; restored $BACKUP. The API is unchanged." >&2
  exit 1
fi
