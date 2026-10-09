# CricScore Web

Next.js version of the CricScore app, served at https://score.glamofashion.com/.
Same screens and scoring as the mobile app, using the same API (`/api/...`) — the API code is not changed.

## Run locally

```bash
cd web
npm install
npm run dev                      # http://localhost:3400, /api is proxied to the live server
API_ORIGIN=http://localhost:3000 npm run dev   # use a local API instead
```

## Deploy

```bash
cd web
bash deploy/deploy.sh            # asks for the server's root password once
```

It uploads to `/var/www/cricscore-web`, builds on the server, runs it with systemd
(`cricscore-web`, port 3400) and points Nginx `/` at it. API paths (`/api`, `/stream`, `/overlay`,
`/go`, `/watch`, `/rtc`, `/health`, `/docs`) keep going to the API.

Logs: `journalctl -u cricscore-web -f` · Restart: `systemctl restart cricscore-web`

## Layout

- `app/` — routes (`/`, `/setup`, `/bet`, `/toss`, `/scoring`, `/scorecard`, `/teams`, `/live`, `/video/[code]`, `/welcome`)
- `screens/` — the app's screens, ported to React DOM + CSS Modules
- `components/` — shared UI (Popup, sheets, QR code, charts…)
- `lib/services/` — the app's API services (matches, teams, live sync, stream)

App changes are not copied automatically: update the matching screen here too.
