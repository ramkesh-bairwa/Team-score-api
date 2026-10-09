// @ts-nocheck — copied from the Express API (src/stream.js, mount()): HTTP part of WebRTC streaming.
import crypto from 'crypto';
import { Router } from '../express';
import { CODE_RE, MAX_VIEWERS, iceServers, room, rooms } from '../streamRooms';

const router = new Router();
const port = process.env.PORT || 3000;
const publicBase = req => (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');

// Only the scoring phone (holding the match's live-session token) can create the broadcast link
router.post('/stream/:code', async (req, res) => {
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

router.get('/stream/:code/status', (req, res) => {
  const r = rooms.get(String(req.params.code).toUpperCase());
  res.json({ live: !!r?.broadcaster, viewers: r ? r.viewers.size : 0, maxViewers: MAX_VIEWERS });
});
router.get('/stream-ice', (req, res) => res.json({ iceServers: iceServers() }));

export default router;
