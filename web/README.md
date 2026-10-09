# CricScore Web

Next.js version of the CricScore app, served at https://score.glamofashion.com/.
Same screens and scoring as the mobile app. Also serves the CricScore API itself (same endpoints and responses as the old Express API).

## Run locally

```bash
cd web
npm install
npm run dev            # http://localhost:3400 — website + API (settings in web/.env, see .env.example)
```

## Deploy

```bash
bash web/deploy/server-update.sh     # from the repo root on your Mac; asks for the server password once
```

Pulls `main` on the server into `/var/www/cricscore-next`, reuses the current API's `.env` and `data/`,
test-runs the new server and compares it with the running API, then switches the API port over to it
(systemd service `cricscore-next`). If anything fails it starts the old API again.

Logs: `journalctl -u cricscore-next -f` · Restart: `systemctl restart cricscore-next`

## Layout

- `app/` — routes (`/`, `/setup`, `/bet`, `/toss`, `/scoring`, `/scorecard`, `/teams`, `/live`, `/video/[code]`, `/welcome`)
- `screens/` — the app's screens, ported to React DOM + CSS Modules
- `components/` — shared UI (Popup, sheets, QR code, charts…)
- `lib/services/` — the website's API client (same as the app)
- `app/api/`, `lib/server/`, `server.ts` — the CricScore API (copied from the old Express API), WebRTC signaling, `/stream` proxy

App changes are not copied automatically: update the matching screen here too.
