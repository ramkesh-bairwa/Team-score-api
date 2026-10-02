// Free WebRTC live streaming for a match.
//   Camera phone: opens /go/:code?k=<key> (from the QR in the app) and taps "Go Live"
//   Viewers:      open /watch/:code and see the video with the live scoreboard
// Video goes peer-to-peer from the camera phone to each viewer; this server only relays the
// connection setup (socket.io), so it costs no server bandwidth. Each viewer uses the camera
// phone's upload, hence the viewer cap (STREAM_MAX_VIEWERS, default 8).
const crypto = require('crypto');
const path = require('path');
const { Server } = require('socket.io');

const MAX_VIEWERS = Number(process.env.STREAM_MAX_VIEWERS) || 8;
const CODE_RE = /^[A-Z0-9]{6}$/;
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;

// code -> { key, broadcaster: socketId|null, viewers: Set<socketId>, touchedAt }
const rooms = new Map();
const room = code => {
  let r = rooms.get(code);
  if (!r) {
    r = { key: null, broadcaster: null, viewers: new Set(), touchedAt: Date.now() };
    rooms.set(code, r);
  }
  r.touchedAt = Date.now();
  return r;
};

setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (!r.broadcaster && !r.viewers.size && now - r.touchedAt > ROOM_TTL_MS) rooms.delete(code);
  }
}, 30 * 60 * 1000).unref();

// STUN finds public addresses (free, Google). Mobile networks often also need a TURN relay:
// set TURN_URL / TURN_USERNAME / TURN_PASSWORD (e.g. coturn on this server) to enable it.
const iceServers = () => {
  const list = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (process.env.TURN_URL) {
    list.push({
      urls: process.env.TURN_URL.split(',').map(s => s.trim()),
      username: process.env.TURN_USERNAME,
      credential: process.env.TURN_PASSWORD,
    });
  }
  return list;
};

// 1) HTTP routes — mount before any catch-all /api handler
function mount(app, { port }) {
  const publicBase = req => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
  const page = name => (req, res) => {
    if (!CODE_RE.test(req.params.code)) return res.status(404).send('Unknown match');
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, '..', 'public', name));
  };

  // Only the scoring phone (holding the match's live-session token) can create the broadcast link
  app.post('/api/stream/:code', async (req, res) => {
    const code = String(req.params.code).toUpperCase();
    const token = String(req.body?.token || '');
    if (!CODE_RE.test(code) || !token) return res.status(400).json({ error: 'Match code and token are required' });
    try {
      const check = await fetch(`http://127.0.0.1:${port}/api/live/${code}/state?token=${encodeURIComponent(token)}&since=999999999`);
      if (!check.ok) return res.status(403).json({ error: 'Not allowed to stream this match' });
    } catch (_) {
      return res.status(503).json({ error: 'Could not verify the match' });
    }
    const r = room(code);
    if (!r.key) r.key = crypto.randomBytes(12).toString('hex');
    const base = publicBase(req);
    res.json({
      broadcastUrl: `${base}/go/${code}?k=${r.key}`,
      watchUrl: `${base}/watch/${code}`,
      maxViewers: MAX_VIEWERS,
    });
  });

  app.get('/api/stream/:code/status', (req, res) => {
    const r = rooms.get(String(req.params.code).toUpperCase());
    res.json({ live: !!r?.broadcaster, viewers: r ? r.viewers.size : 0, maxViewers: MAX_VIEWERS });
  });
  app.get('/api/stream-ice', (req, res) => res.json({ iceServers: iceServers() }));
  app.get('/go/:code', page('go.html'));
  app.get('/watch/:code', page('watch.html'));
}

// 2) Signaling over socket.io — attach to the HTTP server once it exists
function listen(server) {
  const io = new Server(server, { path: '/rtc', cors: { origin: '*' } });

  const counts = (code, r) => {
    const payload = { viewers: r.viewers.size, live: !!r.broadcaster, maxViewers: MAX_VIEWERS };
    io.to(`room:${code}`).emit('status', payload);
  };

  io.on('connection', socket => {
    let joined = null; // { code, role }

    socket.on('join', ({ code, role, key } = {}) => {
      code = String(code || '').toUpperCase();
      if (!CODE_RE.test(code) || joined) return;
      const r = room(code);
      if (role === 'broadcaster') {
        if (!r.key || key !== r.key) return socket.emit('denied', 'This broadcast link is not valid. Scan the QR code in the app again.');
        if (r.broadcaster && r.broadcaster !== socket.id) {
          io.to(r.broadcaster).emit('replaced');
          io.sockets.sockets.get(r.broadcaster)?.disconnect(true);
        }
        r.broadcaster = socket.id;
        joined = { code, role };
        socket.join(`room:${code}`);
        // Start a connection to everyone already waiting
        for (const v of r.viewers) socket.emit('viewer', v);
      } else {
        if (r.viewers.size >= MAX_VIEWERS) return socket.emit('full', MAX_VIEWERS);
        r.viewers.add(socket.id);
        joined = { code, role: 'viewer' };
        socket.join(`room:${code}`);
        if (r.broadcaster) io.to(r.broadcaster).emit('viewer', socket.id);
      }
      counts(code, r);
    });

    // Relay offers/answers/ICE candidates, only between a room's broadcaster and its viewers
    socket.on('signal', ({ to, data } = {}) => {
      if (!joined || typeof to !== 'string') return;
      const r = rooms.get(joined.code);
      if (!r) return;
      const allowed = joined.role === 'broadcaster' ? r.viewers.has(to) : to === r.broadcaster;
      if (allowed) io.to(to).emit('signal', { from: socket.id, data });
    });

    socket.on('disconnect', () => {
      if (!joined) return;
      const r = rooms.get(joined.code);
      if (!r) return;
      if (joined.role === 'broadcaster' && r.broadcaster === socket.id) {
        r.broadcaster = null;
        socket.to(`room:${joined.code}`).emit('ended');
      } else if (joined.role === 'viewer') {
        r.viewers.delete(socket.id);
        if (r.broadcaster) io.to(r.broadcaster).emit('viewer-left', socket.id);
      }
      r.touchedAt = Date.now();
      counts(joined.code, r);
    });
  });

  return io;
}

module.exports = { mount, listen };
