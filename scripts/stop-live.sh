#!/bin/bash
# Stops the server and tunnel started by go-live.sh
cd "$(dirname "$0")/.." || exit 1
for f in logs/tunnel.pid logs/server.pid; do
  [ -f "$f" ] && kill "$(cat "$f")" 2>/dev/null && rm -f "$f"
done
live-stream/scripts/stop.sh >/dev/null
echo "Stopped CricScore server, camera streaming and tunnel."
