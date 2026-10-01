#!/bin/bash
# Stops the live-stream app and its MySQL started by scripts/start.sh
cd "$(dirname "$0")/.." || exit 1
if [ -f logs/app.pid ]; then
  PID=$(cat logs/app.pid)
  pkill -P "$PID" 2>/dev/null; kill "$PID" 2>/dev/null
  rm -f logs/app.pid
fi
# tsx runs the server in a child node process; match both by this project's path
pkill -f "$(pwd)/node_modules/.*tsx.* server.ts" 2>/dev/null
mysqladmin -h127.0.0.1 -P3307 -uroot shutdown 2>/dev/null && rm -f logs/mysql.pid
echo "Live-stream app stopped"
