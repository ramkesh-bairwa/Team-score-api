#!/bin/bash
# Runs ON THE SERVER (sent by add-subdomain.sh). Connects https://$FQDN to a project.
#   MODE=proxy  -> forward to an app already running on this server at $PORT
#   MODE=static -> serve the uploaded website files (single-page apps supported)
#   MODE=node   -> run the uploaded Node.js project as a service on $PORT, then forward to it
set -euo pipefail
trap 'printf "\n\033[1;31m✖ Failed at line %s: %s\033[0m\n" "$LINENO" "$BASH_COMMAND"' ERR
say() { printf '\n\033[1;32m▶ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✖ %s\033[0m\n' "$*"; exit 1; }

: "${FQDN:?}" "${MODE:?}" "${SUB:?}"
BUNDLE=/tmp/subdomain-files.tgz
SITE=/etc/nginx/sites-available/sub-$FQDN

command -v nginx >/dev/null && command -v certbot >/dev/null \
  || { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx certbot python3-certbot-nginx >/dev/null; }

case "$MODE" in
  proxy)
    : "${PORT:?}"
    curl -s -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/" \
      || echo "⚠️  Nothing answers on port $PORT yet — the site will show 502 until your app runs there."
    ;;
  static)
    say "Installing website files into /var/www/$FQDN"
    rm -rf "/var/www/$FQDN.new" && mkdir -p "/var/www/$FQDN.new"
    tar xzf "$BUNDLE" -C "/var/www/$FQDN.new"
    rm -rf "/var/www/$FQDN" && mv "/var/www/$FQDN.new" "/var/www/$FQDN"
    chown -R www-data:www-data "/var/www/$FQDN"
    [ -f "/var/www/$FQDN/index.html" ] || echo "⚠️  No index.html at the top of the uploaded folder."
    ;;
  node)
    : "${PORT:?}"
    APP_DIR=/opt/apps/$SUB
    command -v node >/dev/null || fail "Node.js is not installed on the server (run deploy.sh once first)"
    if ss -ltn | grep -q ":$PORT " && ! systemctl is-active --quiet "app-$SUB"; then
      fail "Port $PORT is already used on the server. Pick another port."
    fi
    say "Installing the Node.js project into $APP_DIR"
    mkdir -p "$APP_DIR"
    [ -f "$APP_DIR/.env" ] && cp "$APP_DIR/.env" /tmp/app-env-keep
    tar xzf "$BUNDLE" -C "$APP_DIR"
    [ -f /tmp/app-env-keep ] && mv /tmp/app-env-keep "$APP_DIR/.env"
    cd "$APP_DIR"
    if [ -f package-lock.json ]; then npm ci --omit=dev --no-audit --no-fund --loglevel=error
    else npm install --omit=dev --no-audit --no-fund --loglevel=error; fi
    START_CMD="${START_CMD:-npm start}"
    cat > "/etc/systemd/system/app-$SUB.service" <<EOF
[Unit]
Description=$FQDN
After=network.target

[Service]
WorkingDirectory=$APP_DIR
ExecStart=/bin/bash -lc '$START_CMD'
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=$PORT

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable "app-$SUB" >/dev/null
    systemctl restart "app-$SUB"
    for i in $(seq 1 20); do curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/" && break; sleep 1; done
    curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$PORT/" \
      || { journalctl -u "app-$SUB" -n 30 --no-pager; fail "The app did not start on port $PORT (it must listen on process.env.PORT)"; }
    echo "Service app-$SUB running (logs: journalctl -u app-$SUB -f)"
    ;;
  *) fail "Unknown mode $MODE" ;;
esac

say "Nginx site for $FQDN (other sites are not touched)"
if [ "$MODE" = static ]; then
  cat > "$SITE" <<EOF
server {
    listen 80;
    server_name $FQDN;
    root /var/www/$FQDN;
    index index.html index.htm;
    location / { try_files \$uri \$uri/ /index.html; }
}
EOF
else
  cat > "$SITE" <<EOF
server {
    listen 80;
    server_name $FQDN;
    client_max_body_size 50m;
    location / {
        proxy_pass http://127.0.0.1:$PORT;
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
fi
ln -sf "$SITE" "/etc/nginx/sites-enabled/sub-$FQDN"
nginx -t
systemctl reload nginx

say "HTTPS certificate"
certbot --nginx -d "$FQDN" --non-interactive --agree-tos --register-unsafely-without-email --redirect \
  || fail "Certificate failed. Make sure $FQDN points to this server and ports 80/443 are open."

rm -f "$BUNDLE"
printf '\n\033[1;32m✅ https://%s is live\033[0m\n' "$FQDN"
