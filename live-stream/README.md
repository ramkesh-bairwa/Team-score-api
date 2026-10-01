# LiveStream

Go live from your camera and microphone, share a link, and viewers watch in real time.

- **Next.js 16** (App Router, TypeScript) + **Tailwind CSS 4**
- **MySQL** via `mysql2`, no ORM
- **WebRTC** carries the audio and video, peer-to-peer from the broadcaster to each viewer
- **Socket.IO** carries signaling, room management and viewer presence only. No media goes through it.

```
Broadcaster (camera + mic) ──WebRTC──▶ Viewer 1
                           ──WebRTC──▶ Viewer 2 …
          ╲                                ╱
           ╲──── Socket.IO (signaling) ───╱
```

## Setup

```bash
cp .env.example .env              # then fill in DATABASE_* and SESSION_SECRET
openssl rand -base64 48           # paste the output into SESSION_SECRET
npm install
npm run db:migrate                # creates DATABASE_NAME and applies database/schema.sql
npm run dev                       # http://localhost:3000
```

Production: `npm run build && npm start`.

Next.js and Socket.IO share one server and one port (`server.ts`), so the app has to be started with these scripts. `next dev` / `next start` on their own would run without signaling.

## Try it

1. Register, open **Go live**, and create a room.
2. You land in the studio at `/live/<roomId>`, with a camera preview. Press **Go live**.
3. Open the viewer link on another device or browser. It doesn't need an account.

The room owner always sees the studio at `/live/<roomId>`. Everyone else sees the viewer.

## Testing across devices

Browsers only allow camera access on **HTTPS or `localhost`**.

- **Watching** from another device works over plain HTTP on your LAN, e.g. `http://192.168.1.20:3000/live/<roomId>`.
- **Broadcasting** from a phone or another machine needs HTTPS. Either:
  - generate a local certificate (`mkcert 192.168.1.20 localhost`) and set `HTTPS_KEY_FILE` / `HTTPS_CERT_FILE`, or
  - expose the app through an HTTPS tunnel (ngrok, Cloudflare Tunnel).

  If you serve over HTTPS, also set `NEXT_PUBLIC_APP_URL` to the `https://` address so the session cookie gets the `Secure` flag.

**TURN:** STUN alone is enough on most home and office networks. Viewers behind strict NATs or mobile carriers need a TURN server, configured with `TURN_SERVER` / `TURN_USERNAME` / `TURN_PASSWORD` (e.g. coturn or a hosted TURN service). Credentials are served at runtime from `/api/ice-servers` and never bundled into client JS. Every viewer receives them, so use short-lived or rate-limited TURN credentials in production.

## Running with CricScore

In this repo the app runs behind the CricScore server at **`/stream`**, so one address and one https tunnel serve both:

```bash
server/scripts/go-live.sh     # CricScore server + this app (+ its MySQL) + Cloudflare https tunnel
server/scripts/stop-live.sh   # stops all of it
server/live-stream/scripts/start.sh | stop.sh   # just this app and its MySQL
```

`scripts/start.sh` runs a dedicated MySQL on `127.0.0.1:3307` (data in `.mysql/`, root with no password, local connections only), applies the schema, rebuilds if sources changed, and starts the app on port 3100. Logs are in `logs/`.

**Camera phone flow:** in the CricScore app, connect the second phone as **📺 Live Stream** → **🎥 Open Camera Studio**. CricScore asks this app for the match's room (`POST /api/integrations/cricscore/rooms`, authenticated with `INTEGRATION_SECRET` = `LIVE_STREAM_SECRET` in `server/.env`) and opens a one-day link that signs the browser into **that room only**. The studio draws the live score from the CricScore overlay feed onto the video, so viewers and the recording both show it. **Share Watch Link** sends the public `/stream/live/<roomId>` page.

The camera needs https: use the tunnel address from `go-live.sh` as the server address in the app.

## Recording & YouTube upload

While live, the studio records the outgoing video (camera + scoreboard + mic) and uploads it to the server in 4-second chunks (`recordings/`). Long matches never have to fit in the phone's memory, and a dropped connection only delays chunks. Pausing pauses the recording. A page reload while live starts a new part.

After **End stream**, the studio lists each part with **Download** and **Upload to YouTube** (title, visibility). Uploads run on the server with YouTube's resumable upload, and progress shows live.

### One-time YouTube setup (~5 minutes)

1. In [Google Cloud Console](https://console.cloud.google.com/), create a project and enable **YouTube Data API v3**.
2. **OAuth consent screen**: External, add your Google account under *Test users*.
3. **Credentials → Create credentials → OAuth client ID → "TVs and Limited Input devices"**.
4. Put the client ID and secret in `.env` as `YOUTUBE_CLIENT_ID` / `YOUTUBE_CLIENT_SECRET`, then run `scripts/stop.sh && scripts/start.sh`.
5. After a stream, tap **Connect YouTube**, open google.com/device on any device, and enter the code shown.

Sign-in uses Google's device flow, so no redirect URL has to be registered. That matters because the tunnel address changes on every run. The refresh token is stored AES-256-GCM-encrypted, so you only connect once.

**YouTube limits to know:**
- Until Google audits your API project, YouTube locks videos uploaded through the API to **private**. They upload fine, but you have to change visibility in YouTube Studio yourself. To lift this, request an audit: https://support.google.com/youtube/contact/yt_api_form
- The default API quota allows about 6 uploads per day.

## How it works

### Signaling flow

1. The broadcaster connects and sends `join-room` (`role: broadcaster`). The server checks that the session cookie belongs to the room owner and that no other broadcaster socket is active.
2. A viewer sends `join-room` (`role: viewer`). The server records a `viewer_sessions` row and broadcasts `viewer-count-updated`.
3. When the broadcaster sends `stream-started`, the room becomes `LIVE` and the server sends the broadcaster a `viewer-joined` for every waiting viewer. Viewers who arrive later trigger `viewer-joined` as they join.
4. For each `viewer-joined`, the broadcaster opens an `RTCPeerConnection`, adds its tracks and sends an `offer`. The viewer replies with an `answer`, and both sides trickle `ice-candidate`s. The server relays these only between the broadcaster and a viewer of the same room, in the correct direction.

### Events

| Event | Direction | Purpose |
| --- | --- | --- |
| `join-room` / `leave-room` | client → server | Enter or leave a room as broadcaster or viewer (acknowledged) |
| `viewer-joined` / `viewer-left` | server → broadcaster | Open or close the peer connection for that viewer |
| `offer` / `answer` / `ice-candidate` | relayed | WebRTC negotiation |
| `stream-started` | broadcaster → server → viewers | Room becomes `LIVE` |
| `stream-stopped` | broadcaster → server → viewers | Paused, back to `WAITING` (the room stays open) |
| `stream-ended` | broadcaster → server → all | Room becomes `ENDED` for good |
| `viewer-count-updated` | server → all | Live viewer count |
| `broadcaster-disconnected` | server → viewers | Broadcaster dropped; the room stays open for the grace period |

### Reconnection

- **Broadcaster drops or refreshes:** viewers see "waiting for them to come back". If the broadcaster doesn't return within `BROADCASTER_RECONNECT_GRACE_MS` (default 60 s), the room is ended automatically. After a refresh, press **Go live** again to resume. A socket-level reconnect resumes without a click.
- **Viewer's connection fails:** the viewer re-joins, which makes the broadcaster send a fresh offer. Socket.IO reconnects automatically.

## Scaling note

This is a mesh setup: the broadcaster uploads one copy of the stream per viewer. A typical home connection handles roughly 5–10 viewers at 720p. For larger audiences, keep this signaling layer and put an SFU in the middle (mediasoup, LiveKit, Janus), so the broadcaster uploads once.

Room state (who is connected) lives in memory in a single Node process. To run several instances, add the Socket.IO Redis adapter and move room state to Redis.

## Security

- Passwords are hashed with bcrypt (cost 12). Logins for unknown emails take the same time as wrong passwords.
- Sessions are HS256 JWTs signed with `SESSION_SECRET`, in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` when `NEXT_PUBLIC_APP_URL` is https).
- State-changing API routes reject cross-origin requests (`Origin` check).
- Every API body and Socket.IO payload is validated with Zod.
- Only the room owner can broadcast, and only one broadcaster per room at a time.
- Database credentials are server-only environment variables. Nothing database-related is prefixed `NEXT_PUBLIC_`.

## Structure

```
server.ts                 Next.js + Socket.IO on one HTTP(S) server
database/schema.sql       Tables, foreign keys, indexes
scripts/migrate.ts        npm run db:migrate
src/app/                  Pages and API routes
src/components/           UI (BroadcasterView, ViewerView, …)
src/hooks/                useBroadcaster / useViewer (WebRTC), useFullscreen, useIceServers
src/lib/                  db pool, auth, session, validation, data access
src/server/socket.ts      Signaling, room management, presence
src/types/socket.ts       Typed Socket.IO events shared by client and server
```
