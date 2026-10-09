#!/bin/bash
# Runs ON THE SERVER (deploy.sh calls it): installs Node 22 if missing, builds the website and runs it
# with systemd as "cricscore-web" on 127.0.0.1:$WEB_PORT (restarts on crash and after reboot).
set -euo pipefail
APP_DIR="${APP_DIR:-/var/www/cricscore-web}"
WEB_PORT="${WEB_PORT:-3400}"
cd "$APP_DIR"

# Node 20+ is needed for Next.js
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 20 ]; then
  echo "Installing Node.js 22…"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
fi
echo "node $(node -v)"

# Refuse to take over a port another program already uses
if ss -ltnp | grep -q ":$WEB_PORT " && ! systemctl is-active --quiet cricscore-web; then
  echo "Port $WEB_PORT is already used by another program on this server" >&2; exit 1
fi

export NEXT_TELEMETRY_DISABLED=1
npm ci --no-audit --no-fund
npm run build
# Standalone output needs the static files and public/ next to server.js
cp -r .next/static .next/standalone/.next/static
cp -r public .next/standalone/public
chown -R www-data:www-data "$APP_DIR"

cat > /etc/systemd/system/cricscore-web.service <<UNIT
[Unit]
Description=CricScore website (Next.js)
After=network.target

[Service]
User=www-data
WorkingDirectory=$APP_DIR/.next/standalone
Environment=NODE_ENV=production
Environment=PORT=$WEB_PORT
Environment=HOSTNAME=127.0.0.1
Environment=NEXT_TELEMETRY_DISABLED=1
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable cricscore-web >/dev/null 2>&1
systemctl restart cricscore-web
for i in $(seq 1 30); do curl -fs -o /dev/null "http://127.0.0.1:$WEB_PORT/" && break; sleep 1; done
curl -fs -o /dev/null "http://127.0.0.1:$WEB_PORT/" || { journalctl -u cricscore-web -n 40 --no-pager; exit 1; }
echo "Website running on 127.0.0.1:$WEB_PORT (systemctl status cricscore-web)"
