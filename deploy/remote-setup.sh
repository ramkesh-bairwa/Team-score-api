#!/bin/bash
# Runs ON THE SERVER (sent by deploy.sh). Installs/updates the CricScore API at https://$DOMAIN,
# and optionally MySQL + phpMyAdmin at https://$DB_DOMAIN.
# Safe to re-run: keeps existing data and only adds its own Nginx sites.
set -euo pipefail

DOMAIN="${DOMAIN:-score.glamofashion.com}"
DB_DOMAIN="${DB_DOMAIN:-}"          # e.g. db.glamofashion.com -> MySQL + phpMyAdmin (needs the passwords below)
APP_DB_PASS="${APP_DB_PASS:-}"      # MySQL user 'cricscore' used by the API
PMA_USER="${PMA_USER:-cricadmin}"; PMA_DB_PASS="${PMA_DB_PASS:-}"   # MySQL login inside phpMyAdmin
WEB_USER="${WEB_USER:-admin}"; WEB_PASS="${WEB_PASS:-}"             # browser login in front of phpMyAdmin
APP_PORT="${APP_PORT:-3200}"
APP_DIR=/opt/cricscore
BUNDLE=/tmp/cricscore-server.tgz

say() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*"; exit 1; }
# Show exactly which step failed
trap 'printf "\n\033[1;31m✖ Failed at line %s: %s\033[0m\n" "$LINENO" "$BASH_COMMAND"' ERR

echo "Server: $(. /etc/os-release && echo "$PRETTY_NAME")"
[ "$(id -u)" = 0 ] || fail "Run as root"
command -v apt-get >/dev/null || fail "This script supports Ubuntu/Debian servers only"
[ -f "$BUNDLE" ] || fail "Missing $BUNDLE"

say "Checking the server before changing anything"
if ss -ltnp 2>/dev/null | grep -q ":$APP_PORT " && ! systemctl is-active --quiet cricscore; then
  fail "Port $APP_PORT is already used by another program. Re-run with APP_PORT=<free port>."
fi
if ss -ltnp 2>/dev/null | grep -E ':80 ' | grep -qv nginx; then
  ss -ltnp | grep -E ':80 ' || true
  fail "Port 80 is used by something other than Nginx (e.g. Apache). Not changing it automatically."
fi

say "Installing packages (nginx, certbot, Node.js if needed)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates nginx certbot python3-certbot-nginx >/dev/null
node_major() { node -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/' || echo 0; }
if [ "$(node_major)" -lt 20 ] 2>/dev/null || ! command -v node >/dev/null; then
  # NodeSource first; on brand-new Ubuntu releases it may not be supported yet, so fall back to Ubuntu's own packages
  if curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh && bash /tmp/nodesource_setup.sh >/dev/null 2>&1 \
     && apt-get install -y -qq nodejs >/dev/null 2>&1; then
    echo "Node.js from NodeSource"
  else
    echo "NodeSource not available for this Ubuntu, using Ubuntu's Node.js"
    rm -f /etc/apt/sources.list.d/nodesource*.list /etc/apt/sources.list.d/nodesource*.sources
    apt-get update -qq
    apt-get install -y -qq nodejs npm >/dev/null
  fi
fi
command -v npm >/dev/null || apt-get install -y -qq npm >/dev/null
[ "$(node_major)" -ge 18 ] || fail "Node.js 18+ is required, found $(node -v)"
echo "node $(node -v), npm $(npm -v), $(nginx -v 2>&1)"

if [ -n "$DB_DOMAIN" ]; then
  [ -n "$APP_DB_PASS" ] && [ -n "$PMA_DB_PASS" ] && [ -n "$WEB_PASS" ] || fail "Database passwords missing"
  say "MySQL database (only reachable from this server)"
  apt-get install -y -qq --no-install-recommends mysql-server >/dev/null
  systemctl enable --now mysql >/dev/null
  mysql <<SQL
CREATE DATABASE IF NOT EXISTS cricscore CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS 'cricscore'@'localhost' IDENTIFIED BY '$APP_DB_PASS';
CREATE USER IF NOT EXISTS 'cricscore'@'127.0.0.1' IDENTIFIED BY '$APP_DB_PASS';
ALTER USER 'cricscore'@'localhost' IDENTIFIED BY '$APP_DB_PASS';
ALTER USER 'cricscore'@'127.0.0.1' IDENTIFIED BY '$APP_DB_PASS';
GRANT ALL PRIVILEGES ON cricscore.* TO 'cricscore'@'localhost';
GRANT ALL PRIVILEGES ON cricscore.* TO 'cricscore'@'127.0.0.1';
CREATE USER IF NOT EXISTS '$PMA_USER'@'localhost' IDENTIFIED BY '$PMA_DB_PASS';
ALTER USER '$PMA_USER'@'localhost' IDENTIFIED BY '$PMA_DB_PASS';
GRANT ALL PRIVILEGES ON cricscore.* TO '$PMA_USER'@'localhost';
FLUSH PRIVILEGES;
SQL
  echo "Database 'cricscore' ready"
fi

say "Installing the CricScore server into $APP_DIR"
mkdir -p "$APP_DIR/data" "$APP_DIR/logs"
tar xzf "$BUNDLE" -C "$APP_DIR"
cd "$APP_DIR"
cat > .env <<EOF
PORT=$APP_PORT
DB_RUN=false
PUBLIC_URL=https://$DOMAIN
EOF
if [ -n "$DB_DOMAIN" ]; then
  cat >> .env <<EOF
STORAGE=mysql
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=cricscore
MYSQL_PASSWORD=$APP_DB_PASS
MYSQL_DATABASE=cricscore
EOF
fi
chmod 600 .env
npm install --omit=dev --no-audit --no-fund --loglevel=error

say "Running it as a service (restarts automatically, starts on boot)"
cat > /etc/systemd/system/cricscore.service <<EOF
[Unit]
Description=CricScore API
After=network.target mysql.service

[Service]
WorkingDirectory=$APP_DIR
ExecStart=$(command -v node) index.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now cricscore >/dev/null
systemctl restart cricscore
for i in $(seq 1 20); do curl -fs "http://127.0.0.1:$APP_PORT/health" >/dev/null && break; sleep 1; done
curl -fs "http://127.0.0.1:$APP_PORT/health" >/dev/null || { journalctl -u cricscore -n 30 --no-pager; fail "Server did not start"; }

say "Nginx site for $DOMAIN (other sites are left untouched)"
cat > /etc/nginx/sites-available/cricscore <<EOF
server {
    listen 80;
    server_name $DOMAIN;
    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 300s;
    }
}
EOF
ln -sf /etc/nginx/sites-available/cricscore /etc/nginx/sites-enabled/cricscore
# Unknown names on HTTPS are refused instead of falling through to the first site
# (only if no other site already claims the default HTTPS server)
if ! grep -rqsE 'listen[^;]*443[^;]*default_server' /etc/nginx/sites-enabled/ /etc/nginx/conf.d/; then
  cat > /etc/nginx/sites-available/00-reject-unknown <<'EOF'
server {
    listen 443 ssl default_server;
    listen [::]:443 ssl default_server;
    server_name _;
    ssl_reject_handshake on;
}
EOF
  ln -sf /etc/nginx/sites-available/00-reject-unknown /etc/nginx/sites-enabled/00-reject-unknown
  nginx -t 2>/dev/null || { rm -f /etc/nginx/sites-enabled/00-reject-unknown; echo "(skipped catch-all: not supported by this nginx)"; }
fi
nginx -t
systemctl enable --now nginx >/dev/null
systemctl reload nginx

if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow 'Nginx Full' >/dev/null && echo "Firewall: opened ports 80/443"
fi

say "HTTPS certificate (Let's Encrypt)"
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect \
  || fail "Certificate failed. Check that $DOMAIN points to this server, then re-run."

if [ -n "$DB_DOMAIN" ]; then
  say "phpMyAdmin at https://$DB_DOMAIN"
  apt-get install -y -qq --no-install-recommends php-fpm php-mysql php-mbstring php-xml php-zip php-gd php-curl php-intl php-bcmath unzip >/dev/null
  PHP_FPM=$(systemctl list-unit-files | grep -o 'php[0-9.]*-fpm' | head -1)
  systemctl enable --now "$PHP_FPM" >/dev/null
  PHP_SOCK=$(ls /run/php/php*-fpm.sock | head -1)
  PMA_DIR=/var/www/phpmyadmin
  curl -fsSL https://www.phpmyadmin.net/downloads/phpMyAdmin-latest-all-languages.tar.gz -o /tmp/pma.tgz
  rm -rf /tmp/pma && mkdir -p /tmp/pma && tar xzf /tmp/pma.tgz -C /tmp/pma --strip-components=1
  [ -f "$PMA_DIR/config.inc.php" ] && cp "$PMA_DIR/config.inc.php" /tmp/pma/config.inc.php
  rm -rf "$PMA_DIR" && mv /tmp/pma "$PMA_DIR" && rm -f /tmp/pma.tgz
  if [ ! -f "$PMA_DIR/config.inc.php" ]; then
    SECRET=$(openssl rand -hex 16)
    cat > "$PMA_DIR/config.inc.php" <<EOF
<?php
\$cfg['blowfish_secret'] = '$SECRET';
\$i = 1;
\$cfg['Servers'][\$i]['auth_type'] = 'cookie';
\$cfg['Servers'][\$i]['host'] = 'localhost';
\$cfg['Servers'][\$i]['AllowNoPassword'] = false;
\$cfg['Servers'][\$i]['AllowRoot'] = false;
\$cfg['TempDir'] = '$PMA_DIR/tmp';
EOF
  fi
  rm -rf "$PMA_DIR/setup"
  mkdir -p "$PMA_DIR/tmp" && chown -R www-data:www-data "$PMA_DIR"
  printf '%s:%s\n' "$WEB_USER" "$(openssl passwd -apr1 "$WEB_PASS")" > /etc/nginx/.htpasswd-cricscore-db
  chmod 640 /etc/nginx/.htpasswd-cricscore-db && chown root:www-data /etc/nginx/.htpasswd-cricscore-db
  cat > /etc/nginx/sites-available/cricscore-db <<EOF
server {
    listen 80;
    server_name $DB_DOMAIN;
    root $PMA_DIR;
    index index.php;
    client_max_body_size 64m;

    auth_basic "CricScore database";
    auth_basic_user_file /etc/nginx/.htpasswd-cricscore-db;

    location ~ ^/(libraries|templates|vendor|tmp|sql)/ { deny all; }
    location ~ /\. { deny all; }
    location = /config.inc.php { deny all; }
    location / { try_files \$uri \$uri/ /index.php?\$args; }
    location ~ \.php\$ {
        include snippets/fastcgi-php.conf;
        fastcgi_pass unix:$PHP_SOCK;
    }
}
EOF
  ln -sf /etc/nginx/sites-available/cricscore-db /etc/nginx/sites-enabled/cricscore-db
  nginx -t && systemctl reload nginx
  certbot --nginx -d "$DB_DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect \
    || fail "Certificate for $DB_DOMAIN failed. Check that it points to this server, then re-run."
  curl -s -o /dev/null -w "phpMyAdmin (401 = asks for login, as expected): %{http_code}\n" "https://$DB_DOMAIN/"
fi

say "Checking https://$DOMAIN"
sleep 2
curl -fs "https://$DOMAIN/health" && echo
curl -fs "https://$DOMAIN/api/shared-teams" >/dev/null && echo "Teams API OK (storage: $( [ -n "$DB_DOMAIN" ] && echo MySQL || echo files))"
curl -fs -o /dev/null "https://$DOMAIN/rtc/socket.io.min.js" && echo "Live streaming OK (https://$DOMAIN/watch/<code>)"
rm -f "$BUNDLE"
printf '\n\033[1;32m✅ CricScore is live at https://%s\033[0m\n' "$DOMAIN"
echo "   API:      https://$DOMAIN/api"
echo "   Overlay:  https://$DOMAIN/overlay/<MATCH CODE>"
echo "   Stream:   https://$DOMAIN/watch/<MATCH CODE>"
echo "   Logs:     journalctl -u cricscore -f"
if [ -n "$DB_DOMAIN" ]; then echo "   Database: https://$DB_DOMAIN (logins are in deploy/.credentials on your Mac)"; fi
