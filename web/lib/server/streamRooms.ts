// @ts-nocheck — copied from the Express API (src/stream.js): shared rooms state for WebRTC streaming.
// Free WebRTC live streaming for a match.
//   Camera phone: opens /go/:code?k=<key> (from the QR in the app) and taps "Go Live"
//   Viewers:      open /watch/:code and see the video with the live scoreboard
// Video goes peer-to-peer from the camera phone to each viewer; this server only relays the
// connection setup (socket.io), so it costs no server bandwidth. Each viewer uses the camera
// phone's upload, hence the viewer cap (STREAM_MAX_VIEWERS, default 8).
import { once } from './state';

export const MAX_VIEWERS = Number(process.env.STREAM_MAX_VIEWERS) || 8;
export const CODE_RE = /^[A-Z0-9]{6}$/;
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;

// code -> { key, broadcaster: socketId|null, viewers: Set<socketId>, touchedAt }
export const rooms = once('streamRooms', () => new Map());
export const room = code => {
  let r = rooms.get(code);
  if (!r) {
    r = { key: null, broadcaster: null, viewers: new Set(), touchedAt: Date.now() };
    rooms.set(code, r);
  }
  r.touchedAt = Date.now();
  return r;
};

once('streamSweep', () => setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (!r.broadcaster && !r.viewers.size && now - r.touchedAt > ROOM_TTL_MS) rooms.delete(code);
  }
}, 30 * 60 * 1000).unref());

// STUN finds public addresses (free, Google). Mobile networks often also need a TURN relay:
// set TURN_URL / TURN_USERNAME / TURN_PASSWORD (e.g. coturn on this server) to enable it.
export const iceServers = () => {
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
