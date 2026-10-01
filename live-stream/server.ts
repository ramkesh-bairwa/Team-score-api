import './src/server/env';
import { readFileSync } from 'node:fs';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import next from 'next';
import { Server } from 'socket.io';
import { registerSocketHandlers, type IO } from './src/server/socket';
import { BASE_PATH } from './src/lib/paths';

// Next.js and Socket.IO share one HTTP server and port
const dev = process.env.NODE_ENV !== 'production';
const port = Number(process.env.PORT || 3000);
const hostname = process.env.HOST || '0.0.0.0';

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function main() {
  await app.prepare();

  const handler = (req: IncomingMessage, res: ServerResponse) => handle(req, res);
  const { HTTPS_KEY_FILE, HTTPS_CERT_FILE } = process.env;
  const useHttps = !!(HTTPS_KEY_FILE && HTTPS_CERT_FILE);
  const server = useHttps
    ? createHttpsServer({ key: readFileSync(HTTPS_KEY_FILE!), cert: readFileSync(HTTPS_CERT_FILE!) }, handler)
    : createHttpServer(handler);

  const io: IO = new Server(server, {
    path: `${BASE_PATH}/socket.io`,
    // Leave non-Socket.IO upgrades (Next.js HMR) alone
    destroyUpgrade: false,
    maxHttpBufferSize: 1e6,
  });
  registerSocketHandlers(io);

  server.listen(port, hostname, () => {
    console.log(`> Ready on ${useHttps ? 'https' : 'http'}://localhost:${port}${BASE_PATH} (${dev ? 'development' : 'production'})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
