# CricScore Web + Live Stream

| Folder | What it is | Runs at |
|---|---|---|
| `web/` | Next.js version of the CricScore app: scoring, teams, match setup, scorecard, live stream controls | https://score.glamofashion.com/ |
| `live-stream/` | Camera studio and match video app (Next.js) | https://score.glamofashion.com/stream |
| `webrtc-stream/` | Phone-camera streaming: `stream.js` (signaling) and the `go.html` / `watch.html` pages | `/go/:code`, `/watch/:code` |

The website and the mobile app read and save matches, teams and live scores through the CricScore API
(`/api/...`), which keeps running on the server. Its code was removed from this branch; it is kept in
git history (branch `running-copy`, commit `dba3ad5`).

## Website

```bash
cd web && npm install && npm run dev      # http://localhost:3400
cd web && bash deploy/deploy.sh           # deploy: build on server, systemd "cricscore-web", Nginx "/"
```

## Live stream

```bash
cd live-stream && npm install && npm run build && npm start
```

No Docker or Jenkins.
