require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const { createProxyMiddleware } = require('http-proxy-middleware');
const routes = require('./src/routes');
const liveRoutes = require('./src/live');
const teamRoutes = require('./src/teams');
const matchRoutes = require('./src/matches');

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

// Shared teams (file storage, no MySQL needed)
app.use('/api/shared-teams', teamRoutes);

// Matches (file storage, no MySQL needed)
app.use('/api/v2/matches', matchRoutes);

// YouTube score overlay page (add it as a browser source in the streaming app)
app.get('/overlay/:code', (req, res) => res.sendFile(path.join(__dirname, 'src', 'overlay.html')));

if (DB_RUN) {
  app.use('/api', routes);
  console.log('✅ DB_RUN=true — MySQL API routes active');
} else {
  app.use('/api', (req, res) => {
    res.status(503).json({ error: 'DB_RUN is false. Set DB_RUN=true in .env to enable API.' });
  });
  console.log('⚠️  DB_RUN=false — API disabled, app using local storage');
}

app.get('/health', (req, res) => res.json({ status: 'ok', db: DB_RUN }));

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
server.on('upgrade', streamProxy.upgrade);
