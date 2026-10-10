// @ts-nocheck — copied from the Express API (src/stream.js, listen()): socket.io signaling at /rtc.
import { Server } from 'socket.io';
import { CODE_RE, MAX_VIEWERS, room, rooms } from './streamRooms';

// 2) Signaling over socket.io — attach to the HTTP server once it exists
export function listen(server) {
  const io = new Server(server, { path: '/rtc', cors: { origin: '*' }, destroyUpgrade: false });
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
        if (r.overlay) socket.emit('overlay', r.overlay);
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

    // What the camera phone shows on top of the video (the scorecard): mirrored on every viewer
    socket.on('overlay', (data = {}) => {
      if (!joined || joined.role !== 'broadcaster') return;
      const r = rooms.get(joined.code);
      if (!r || r.broadcaster !== socket.id) return;
      r.overlay = { card: !!data.card, tab: Number.isInteger(data.tab) ? data.tab : -1 };
      socket.to(`room:${joined.code}`).emit('overlay', r.overlay);
    });

    socket.on('disconnect', () => {
      if (!joined) return;
      const r = rooms.get(joined.code);
      if (!r) return;
      if (joined.role === 'broadcaster' && r.broadcaster === socket.id) {
        r.broadcaster = null;
        r.overlay = null;
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
