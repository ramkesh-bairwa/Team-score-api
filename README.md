# CricScore Web + Live Stream

| Folder | What it is | Runs at |
|---|---|---|
| `web/` | Next.js: the website **and the CricScore API** (same URLs and responses as the old Express API), WebRTC signaling and the `/stream` proxy, in one server (`web/server.ts`) | https://score.glamofashion.com/ |
| `live-stream/` | Camera studio and match video app (Next.js) | https://score.glamofashion.com/stream |
| `webrtc-stream/` | Reference copy of the old WebRTC files (now served by `web/`: `lib/server/signaling.ts`, `server-pages/`) | — |

The API that the website **and the mobile app** use now lives in `web/` (Next.js route handlers in
`web/app/api`, logic copied unchanged from the old Express API into `web/lib/server`). Endpoints, request
bodies, responses, status codes, CORS and `.env` settings are the same — checked side by side against the
old API (76/76 responses identical, plus WebRTC signaling and the `/stream` proxy).

## Website

```bash
cd web && npm install && npm run dev      # http://localhost:3400 (website + API)
bash web/deploy/server-update.sh     # deploy to the server (see web/README.md)
```

## Live stream

```bash
cd live-stream && npm install && npm run build && npm start
```

No Docker or Jenkins.
