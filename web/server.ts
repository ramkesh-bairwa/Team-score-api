// CricScore server: the website, the API (/api, /health, /overlay, /go, /watch, /docs) and WebRTC
// signaling (/rtc) in one Node process, plus the /stream proxy to the live-stream app.
// Replaces the old Express API (index.js) with the same URLs, responses, CORS and env settings.
//   dev:  npm run dev            prod:  npm run build && npm start
import { loadEnvConfig } from '@next/env';
import http from 'http';
import next from 'next';
import { createProxyMiddleware } from 'http-proxy-middleware';

const dev = process.env.NODE_ENV !== 'production';
loadEnvConfig(process.cwd(), dev);

const PORT = Number(process.env.PORT) || 3000;

async function main() {
  const { listen: listenRtc } = await import('./lib/server/signaling');
  const app = next({ dev, port: PORT });
  const handle = app.getRequestHandler();
  await app.prepare();

  // Built-in camera streaming (live-stream, a separate Next.js app) is served under /stream,
  // so the same address and https tunnel cover both (same settings as the old API).
  const streamProxy = createProxyMiddleware({
    target: process.env.LIVE_STREAM_URL || 'http://localhost:3100',
    pathFilter: '/stream',
    changeOrigin: false, // keep the public Host so the app can check same-origin requests
    xfwd: true,
    ws: true,
    on: {
      error: (err, req, res: any) => {
        if (res && typeof res.writeHead === 'function' && !res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'text/plain' });
          res.end('Camera streaming is not running. Start it with server/scripts/go-live.sh');
        }
      },
    },
  });

  // cors() defaults: any origin; preflight answered with 204
  const cors = (req: http.IncomingMessage, res: http.ServerResponse) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method !== 'OPTIONS') return false;
    res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,PUT,PATCH,POST,DELETE');
    const asked = req.headers['access-control-request-headers'];
    if (asked) res.setHeader('Access-Control-Allow-Headers', asked);
    res.setHeader('Vary', 'Access-Control-Request-Headers');
    res.statusCode = 204;
    res.setHeader('Content-Length', '0');
    res.end();
    return true;
  };

  const server = http.createServer((req, res) => {
    if (cors(req, res)) return;
    if ((req.url || '').startsWith('/stream')) return streamProxy(req as any, res as any, () => handle(req, res));
    handle(req, res);
  });

  // socket.io wraps the request/upgrade listeners and only takes /rtc
  listenRtc(server);

  const nextUpgrade = (app as any).getUpgradeHandler?.();
  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    if (url.startsWith('/stream')) return streamProxy.upgrade(req as any, socket as any, head);
    if (url.startsWith('/rtc')) return; // socket.io
    if (nextUpgrade) return nextUpgrade(req, socket, head);
    socket.destroy();
  });

  server.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log(process.env.DB_RUN === 'true'
      ? '✅ DB_RUN=true — MySQL API routes active'
      : 'ℹ️  DB_RUN=false — legacy /api MySQL routes off (teams, matches, live and streaming APIs are active)');
  });
}

main().catch(e => { console.error(e); process.exit(1); });
