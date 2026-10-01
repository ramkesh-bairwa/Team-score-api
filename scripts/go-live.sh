#!/bin/bash
# Starts the CricScore server and a temporary public https tunnel to it (Cloudflare quick tunnel).
# The printed URL works from anywhere, including mobile data, while this Mac stays on.
# Stop everything with: server/scripts/stop-live.sh
cd "$(dirname "$0")/.." || exit 1
mkdir -p logs

if ! curl -s -m 2 localhost:3000/health >/dev/null; then
  nohup node index.js > logs/server.log 2>&1 &
  echo $! > logs/server.pid
  sleep 2
fi
curl -s -m 2 localhost:3000/health >/dev/null || { echo "Server failed to start — see server/logs/server.log"; exit 1; }

# Built-in camera streaming + recording (served under /stream by the server above)
live-stream/scripts/start.sh || echo "⚠️  Camera streaming did not start — see server/live-stream/logs/"

pkill -f "cloudflared tunnel --url http://localhost:3000" 2>/dev/null
: > logs/tunnel.log
nohup cloudflared tunnel --no-autoupdate --url http://localhost:3000 > logs/tunnel.log 2>&1 &
echo $! > logs/tunnel.pid

for _ in $(seq 1 30); do
  URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' logs/tunnel.log | head -1)
  [ -n "$URL" ] && break
  sleep 1
done
[ -z "$URL" ] && { echo "Tunnel failed to start — see server/logs/tunnel.log"; exit 1; }

echo ""
echo "✅ CricScore is live at: $URL"
echo "   In the app: Home → ⚙️ → enter this address → Save"
echo "   (The address changes every time you run this script.)"
