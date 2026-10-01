#!/bin/bash
# Starts the live-stream app and its own MySQL (port 3307, data in .mysql/) in the background.
# Safe to run repeatedly. Stop with scripts/stop.sh. Logs: logs/
cd "$(dirname "$0")/.." || exit 1
mkdir -p logs
ROOT="$(pwd)"
PORT=$(grep -E '^PORT=' .env 2>/dev/null | cut -d= -f2); PORT=${PORT:-3100}

# 1. MySQL
if ! mysqladmin -h127.0.0.1 -P3307 -uroot ping >/dev/null 2>&1; then
  if [ ! -d .mysql/data ]; then
    echo "Initialising MySQL data directory…"
    mkdir -p .mysql
    mysqld --no-defaults --initialize-insecure --datadir="$ROOT/.mysql/data" > logs/mysql-init.log 2>&1 \
      || { echo "MySQL init failed — see logs/mysql-init.log"; exit 1; }
  fi
  # Run from .mysql so the socket path stays short (macOS limit is ~103 chars)
  (cd .mysql && nohup mysqld --no-defaults --datadir="$ROOT/.mysql/data" --port=3307 --bind-address=127.0.0.1 \
    --socket=mysql.sock --mysqlx=OFF --log-error="$ROOT/logs/mysql.log" & echo $! > "$ROOT/logs/mysql.pid") \
    < /dev/null > /dev/null 2>&1
  for _ in $(seq 1 30); do mysqladmin -h127.0.0.1 -P3307 -uroot ping >/dev/null 2>&1 && break; sleep 1; done
  mysqladmin -h127.0.0.1 -P3307 -uroot ping >/dev/null 2>&1 || { echo "MySQL failed to start — see logs/mysql.log"; exit 1; }
fi
npm run --silent db:migrate || exit 1

# 2. App (production build; rebuilt when sources are newer than the last build)
if [ ! -f .next/BUILD_ID ] || [ -n "$(find src next.config.ts .env -newer .next/BUILD_ID -print -quit 2>/dev/null)" ]; then
  echo "Building live-stream app…"
  npx next build > logs/build.log 2>&1 || { echo "Build failed — see logs/build.log"; exit 1; }
fi
if ! curl -s -m 2 -o /dev/null "localhost:$PORT/stream/login"; then
  NODE_ENV=production nohup "$ROOT/node_modules/.bin/tsx" server.ts < /dev/null > logs/app.log 2>&1 &
  echo $! > logs/app.pid
  for _ in $(seq 1 30); do curl -s -m 2 -o /dev/null "localhost:$PORT/stream/login" && break; sleep 1; done
fi
curl -s -m 2 -o /dev/null "localhost:$PORT/stream/login" || { echo "App failed to start — see logs/app.log"; exit 1; }
echo "✅ Live-stream app running on http://localhost:$PORT/stream"
