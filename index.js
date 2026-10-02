require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const routes = require('./src/routes');
const liveRoutes = require('./src/live');
const teamRoutes = require('./src/teams');
const matchRoutes = require('./src/matches');
const stream = require('./src/stream');

const app = express();
// Behind a tunnel/proxy (cloudflared), use the forwarded https protocol for overlay links
app.set('trust proxy', true);
app.use(cors());

// Built-in camera streaming (server/live-stream, a separate Next.js app) is served under /stream,
// so the same address and https tunnel cover both. Mounted before body parsing so uploads stream through.
const streamProxy = createProxyMiddleware({
  target: process.env.LIVE_STREAM_URL || 'http://localhost:3100',
  pathFilter: '/stream',
  changeOrigin: false, // keep the public Host so the app can check same-origin requests
  xfwd: true,
  ws: true,
  on: {
    error: (err, req, res) => {
      if (res && typeof res.writeHead === 'function' && !res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end('Camera streaming is not running. Start it with server/scripts/go-live.sh');
      }
    },
  },
});
app.use(streamProxy);

app.use(express.json({ limit: '10mb' }));

const DB_RUN = process.env.DB_RUN === 'true';

// Live match sharing is in-memory, so it works regardless of DB_RUN
app.use('/api/live', liveRoutes);

// Shared teams (MySQL with STORAGE=mysql, otherwise JSON files — see src/store.js)
app.use('/api/shared-teams', teamRoutes);

// Matches (same storage as teams)
app.use('/api/v2/matches', matchRoutes);

// YouTube score overlay page (add it as a browser source in the streaming app)
app.get('/overlay/:code', (req, res) => res.sendFile(path.join(__dirname, 'src', 'overlay.html')));

// Free WebRTC live streaming: /go/:code (camera phone) and /watch/:code (viewers)
const PORT = process.env.PORT || 3000;
stream.mount(app, { port: PORT });

if (DB_RUN) {
  app.use('/api', routes);
  console.log('✅ DB_RUN=true — MySQL API routes active');
} else {
  // The old MySQL routes (src/routes.js) are off; every other /api route above works without them
  app.use('/api', (req, res) => {
    res.status(404).json({ error: `Unknown API endpoint: ${req.method} ${req.originalUrl}` });
  });
  console.log('ℹ️  DB_RUN=false — legacy /api MySQL routes off (teams, matches, live and streaming APIs are active)');
}

app.get('/health', (req, res) => res.json({ status: 'ok', db: DB_RUN }));

const server = app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
server.on('upgrade', streamProxy.upgrade);
stream.listen(server);
