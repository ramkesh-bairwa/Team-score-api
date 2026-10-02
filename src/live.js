const express = require('express');
const crypto = require('crypto');
const os = require('os');
const router = express.Router();

// Live scoring sessions are kept in memory: they only need to outlive a match,
// and this keeps sharing usable even when DB_RUN=false.
// code -> { hostToken, hostName, tokens: Set, requests: Map, version, payload, updatedBy, touchedAt,
//           active: { token, deviceId, name } }  <- the one phone currently allowed to score
const sessions = new Map();
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I

const newToken = () => crypto.randomBytes(16).toString('hex');
const newCode = () => {
  let code;
  do {
    code = Array.from({ length: 6 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  } while (sessions.has(code));
  return code;
};

setInterval(() => {
  const now = Date.now();
  for (const [code, sess] of sessions) {
    if (now - sess.touchedAt > SESSION_TTL_MS) sessions.delete(code);
  }
}, 30 * 60 * 1000).unref();

const getSession = (req, res) => {
  const sess = sessions.get(String(req.params.code || '').toUpperCase());
  if (!sess) {
    res.status(404).json({ error: 'Match code not found or expired' });
    return null;
  }
  sess.touchedAt = Date.now();
  return sess;
};

// Base URL that streaming apps should use for the overlay: PUBLIC_URL if set, otherwise the
// address the phone used to reach us, falling back to this machine's LAN IP for loopback/emulator hosts
const lanIp = () => {
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return 'localhost';
};
const publicBase = (req) => {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const host = req.get('host') || '';
  if (host && !/^(localhost|127\.|10\.0\.2\.2)/.test(host)) return `${req.protocol}://${host}`;
  return `http://${lanIp()}:${process.env.PORT || 3000}`;
};
const overlayUrl = (req, code) => `${publicBase(req)}/overlay/${code}`;

const authorized = (sess, token) => !!token && (token === sess.hostToken || sess.tokens.has(token));
const isActive = (sess, token) => !!token && sess.active.token === token;
const activeInfo = (sess) => ({
  activeDevice: sess.active.deviceId, activeName: sess.active.name, streamerName: streamerName(sess),
});

const newSession = ({ token, hostName, deviceId, payload }) => ({
  hostToken: token, hostName: hostName || 'Scorer',
  tokens: new Set([token]), requests: new Map(),
  version: 1, payload: payload || null, updatedBy: deviceId || null, touchedAt: Date.now(),
  active: { token, deviceId: deviceId || null, name: hostName || 'Scorer' },
  // At most 2 devices per match: the scorer + one other (live-stream phone, or a scorer taking over)
  devices: new Map([[deviceId || 'host', { role: 'scorer', name: hostName || 'Scorer', token }]]),
});
const MAX_DEVICES = 2;
const otherDevices = (sess) => [...sess.devices.entries()].filter(([id]) => id !== sess.active.deviceId);
const streamerName = (sess) => (otherDevices(sess).find(([, d]) => d.role === 'streamer') || [null, null])[1]?.name || null;

// POST /live  { hostName, deviceId, payload } -> { code, token }
router.post('/', (req, res) => {
  const { hostName, deviceId, payload } = req.body || {};
  const code = newCode();
  const hostToken = newToken();
  sessions.set(code, newSession({ token: hostToken, hostName, deviceId, payload }));
  res.json({ code, token: hostToken, overlayUrl: overlayUrl(req, code) });
});

// POST /live/restore  { code, token, hostName, deviceId, payload }
// Sessions live in memory, so after a server restart the owner's phone re-registers its
// existing code; links already pasted into a streaming app keep working.
router.post('/restore', (req, res) => {
  const { code, token, hostName, deviceId, payload } = req.body || {};
  if (!/^[A-Z0-9]{6}$/.test(code || '') || !token) return res.status(400).json({ error: 'Invalid session' });
  const existing = sessions.get(code);
  if (existing) {
    if (!authorized(existing, token)) return res.status(409).json({ error: 'Code is in use by another match' });
    return res.json({ code, restored: false });
  }
  // Whoever restores (the phone still scoring) becomes owner and active scorer
  sessions.set(code, newSession({ token, hostName, deviceId, payload }));
  res.json({ code, restored: true });
});

// GET /live/:code/links -> { overlayUrl }
router.get('/:code/links', (req, res) => {
  const sess = getSession(req, res);
  if (!sess) return;
  res.json({ overlayUrl: overlayUrl(req, req.params.code.toUpperCase()) });
});

// POST /live/:code/join  { name, deviceId } -> { requestId, hostName }
router.post('/:code/join', (req, res) => {
  const sess = getSession(req, res);
  if (!sess) return;
  const { name, deviceId } = req.body || {};
  const role = req.body?.role === 'streamer' ? 'streamer' : 'scorer';
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  if (!deviceId) return res.status(400).json({ error: 'Device id is required' });
  if (deviceId === sess.active.deviceId) return res.status(400).json({ error: 'This phone is already scoring this match' });
  // Enforce the two-device limit (a device that is already connected may re-join)
  if (!sess.devices.has(deviceId) && sess.devices.size >= MAX_DEVICES) {
    return res.status(409).json({
      error: 'This match already has 2 devices connected (scorer + live stream). No other device can join.',
      full: true,
    });
  }
  const waiting = [...sess.requests.values()].some(r => r.status === 'pending' && r.deviceId !== deviceId);
  if (waiting) return res.status(409).json({ error: 'Another device is already waiting for approval. Try again in a moment.' });
  const requestId = newToken();
  sess.requests.set(requestId, {
    id: requestId, name: String(name).trim().slice(0, 40), deviceId, role,
    status: 'pending', token: null, createdAt: Date.now(),
  });
  res.json({ requestId, hostName: sess.hostName });
});

// GET /live/:code/requests/:id  -> { status, token?, version?, payload? }  (polled by the joiner)
router.get('/:code/requests/:id', (req, res) => {
  const sess = getSession(req, res);
  if (!sess) return;
  const r = sess.requests.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Request not found' });
  if (r.status !== 'approved') return res.json({ status: r.status, role: r.role });
  res.json({ status: r.status, role: r.role, token: r.token, version: sess.version, payload: sess.payload });
});

// GET /live/:code/requests?token=hostToken -> pending requests (host only)
router.get('/:code/requests', (req, res) => {
  const sess = getSession(req, res);
  if (!sess) return;
  if (!isActive(sess, req.query.token)) return res.status(403).json({ error: 'Only the phone currently scoring can see requests' });
  const list = [...sess.requests.values()]
    .filter(r => r.status === 'pending')
    .map(({ id, name, role, createdAt }) => ({ id, name, role, createdAt }));
  res.json(list);
});

// POST /live/:code/requests/:id  { token, approve } (host only)
router.post('/:code/requests/:id', (req, res) => {
  const sess = getSession(req, res);
  if (!sess) return;
  const { token, approve } = req.body || {};
  if (!isActive(sess, token)) return res.status(403).json({ error: 'Only the phone currently scoring can give access' });
  const r = sess.requests.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'Request not found' });
  if (approve) {
    if (!sess.devices.has(r.deviceId) && sess.devices.size >= MAX_DEVICES) {
      r.status = 'denied';
      return res.status(409).json({ error: 'Already 2 devices connected to this match' });
    }
    r.status = 'approved';
    r.token = newToken();
    sess.tokens.add(r.token);
    sess.devices.set(r.deviceId, { role: r.role, name: r.name, token: r.token });
  } else {
    r.status = 'denied';
  }
  res.json({ success: true, status: r.status });
});

// POST /live/:code/takeover  { token, deviceId, name } -> this phone becomes the only scorer;
// the previous scorer's app sees activeDevice change on its next poll and closes scoring
router.post('/:code/takeover', (req, res) => {
  const sess = getSession(req, res);
  if (!sess) return;
  const { token, deviceId, name } = req.body || {};
  if (!authorized(sess, token)) return res.status(403).json({ error: 'No scoring access' });
  const device = sess.devices.get(deviceId);
  if (device && device.role === 'streamer') return res.status(403).json({ error: 'The live-stream phone cannot score' });
  // The previous scorer is disconnected, freeing its slot
  if (sess.active.deviceId && sess.active.deviceId !== deviceId) sess.devices.delete(sess.active.deviceId);
  sess.active = { token, deviceId: deviceId || null, name: (name || 'Another scorer').slice(0, 40) };
  sess.devices.set(deviceId, { role: 'scorer', name: sess.active.name, token });
  res.json({ success: true, ...activeInfo(sess) });
});

// POST /live/:code/leave  { token, deviceId } -> a connected (non-scoring) device disconnects
router.post('/:code/leave', (req, res) => {
  const sess = getSession(req, res);
  if (!sess) return;
  const { token, deviceId } = req.body || {};
  if (!authorized(sess, token)) return res.status(403).json({ error: 'Not connected' });
  if (deviceId === sess.active.deviceId) return res.status(400).json({ error: 'The scoring phone cannot leave; end the match instead' });
  sess.devices.delete(deviceId);
  if (token !== sess.hostToken) sess.tokens.delete(token);
  res.json({ success: true });
});

// PUT /live/:code/state  { token, deviceId, payload } -> { version }
router.put('/:code/state', (req, res) => {
  const sess = getSession(req, res);
  if (!sess) return;
  const { token, deviceId, payload } = req.body || {};
  if (!authorized(sess, token)) return res.status(403).json({ error: 'No scoring access' });
  if (!isActive(sess, token)) {
    return res.status(409).json({ error: `Scoring has moved to ${sess.active.name}'s phone`, moved: true, ...activeInfo(sess) });
  }
  sess.version += 1;
  sess.payload = payload;
  sess.updatedBy = deviceId || null;
  res.json({ version: sess.version });
});

// GET /live/:code/state?token=&since=version -> { changed, version, payload, updatedBy }
router.get('/:code/state', (req, res) => {
  const sess = getSession(req, res);
  if (!sess) return;
  if (!authorized(sess, req.query.token)) return res.status(403).json({ error: 'No scoring access' });
  const since = parseInt(req.query.since, 10) || 0;
  if (since >= sess.version) return res.json({ changed: false, version: sess.version, ...activeInfo(sess) });
  res.json({ changed: true, version: sess.version, payload: sess.payload, updatedBy: sess.updatedBy, ...activeInfo(sess) });
});

// ─── Public overlay feed (read-only, used by the YouTube overlay page) ────

const ballsOf = (overs) => (overs || []).reduce((n, o) => n + o.length, 0);

// Final result of a finished match, for the "match over" screens: winner, margin, both innings
// and each team's best batter and bowler
const bestBatter = (inn) =>
  [...(inn?.batters || [])].sort((a, b) => b.runs - a.runs || a.balls - b.balls)[0] || null;
const bestBowler = (inn) =>
  [...(inn?.bowlers || [])].sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)[0] || null;
const bat = (p) => p && { name: p.name, runs: p.runs, balls: p.balls, fours: p.fours || 0, sixes: p.sixes || 0, out: !!p.out };
const bowl = (p) => p && { name: p.name, wickets: p.wickets, runs: p.runs, overs: p.overs, balls: p.balls };

const finalResult = (sc) => {
  const i1 = sc.innings1, i2 = sc.innings2;
  if (!i1 || !i2) return null;
  const t1 = sc.battingTeam?.name || 'Team 1', t2 = sc.fieldingTeam?.name || 'Team 2';
  let winner = null, loser = null, margin = '';
  if (i2.runs > i1.runs) {
    const left = (sc.fieldingTeam?.players?.length || 11) - 1 - i2.wickets;
    winner = t2; loser = t1; margin = `by ${left} wicket${left === 1 ? '' : 's'}`;
  } else if (i2.runs < i1.runs) {
    const by = i1.runs - i2.runs;
    winner = t1; loser = t2; margin = `by ${by} run${by === 1 ? '' : 's'}`;
  }
  const team = (name, battingInn, bowlingInn) => ({
    name,
    bestBatter: bat(bestBatter(battingInn)),
    bestBowler: bowl(bestBowler(bowlingInn)),
  });
  return {
    winner, loser, tied: !winner, margin,
    innings: [
      { team: t1, runs: i1.runs, wickets: i1.wickets, overs: i1.overs, balls: i1.balls },
      { team: t2, runs: i2.runs, wickets: i2.wickets, overs: i2.overs, balls: i2.balls },
    ],
    // Innings 1: team 1 bats, team 2 bowls; innings 2 the other way round
    teams: [team(t1, i1, i2), team(t2, i2, i1)],
  };
};

const summarize = (sess) => {
  const p = sess.payload;
  if (!p || !p.params) return { version: sess.version, phase: 'waiting' };
  const prm = p.params;
  const base = {
    version: sess.version,
    phase: p.phase,
    inningsNum: p.inningsNum,
    battingTeam: prm.battingTeam?.name || '',
    bowlingTeam: prm.fieldingTeam?.name || '',
    matchType: prm.matchType || 'local',
    overs: prm.overs,
    target: prm.target || null,
  };

  if (p.phase === 'innings_end') {
    const sc = p.scorecardParams || {};
    const inn = p.inningsNum === 2 ? sc.innings2 : sc.innings1;
    let result = '';
    if (p.inningsNum === 2 && sc.innings1 && sc.innings2) {
      const r1 = sc.innings1.runs, r2 = sc.innings2.runs;
      if (r2 > r1) {
        const left = (sc.fieldingTeam?.players?.length || 11) - 1 - sc.innings2.wickets;
        result = `${sc.fieldingTeam?.name} won by ${left} wicket${left === 1 ? '' : 's'}`;
      } else if (r2 < r1) {
        result = `${sc.battingTeam?.name} won by ${r1 - r2} run${r1 - r2 === 1 ? '' : 's'}`;
      } else {
        result = 'Match tied';
      }
    }
    return {
      ...base,
      runs: inn?.runs ?? 0, wickets: inn?.wickets ?? 0,
      over: inn?.overs ?? 0, ball: inn?.balls ?? 0,
      result,
      final: p.inningsNum === 2 ? finalResult(sc) : null,
    };
  }

  const st = p.savedState || {};
  const batters = st.batters || [];
  const si = st.strikerIdx ?? 0;
  const thisOver = st.balls || [];
  const all = [...(st.overHistory || []).flat(), ...thisOver];
  return {
    ...base,
    runs: st.totalRuns ?? 0,
    wickets: st.wickets ?? 0,
    over: st.currentOver ?? 0,
    ball: st.currentBall ?? 0,
    striker: batters[si] ? { name: batters[si].name, runs: batters[si].runs, balls: batters[si].balls } : null,
    nonStriker: batters[si === 0 ? 1 : 0] ? (({ name, runs, balls }) => ({ name, runs, balls }))(batters[si === 0 ? 1 : 0]) : null,
    bowler: st.bowlers && st.bowlers[st.currentBowlerIdx ?? 0] || null,
    thisOver,
    // Number of deliveries so far + the latest one, so the overlay can animate new boundaries/wickets
    deliveries: ballsOf(st.overHistory) + thisOver.length,
    lastBall: all[all.length - 1] || null,
    lastCommentary: (st.ballLog && st.ballLog.length && st.ballLog[st.ballLog.length - 1].text) || '',
  };
};

// ─── Built-in camera stream (server/live-stream) ──────────────────────
// POST /live/:code/camera { token } -> { studioUrl, watchUrl }
// Any device in the match gets the room for this match (created on first call). studioUrl signs the
// opening browser into that one room as the camera (the scorer shows it as a QR code, so any phone
// or laptop can be the camera); watchUrl is the public viewer page.
router.post('/:code/camera', async (req, res) => {
  const sess = getSession(req, res);
  if (!sess) return;
  if (!authorized(sess, req.body?.token)) return res.status(403).json({ error: 'Not part of this match' });

  const target = (process.env.LIVE_STREAM_URL || 'http://localhost:3100').replace(/\/$/, '');
  const secret = process.env.LIVE_STREAM_SECRET;
  if (!secret) return res.status(503).json({ error: 'Camera streaming is not configured on the server (LIVE_STREAM_SECRET)' });

  const code = req.params.code.toUpperCase();
  const s = summarize(sess);
  // A finished match stays closed: no new camera room, the links show the result
  if (s.final) return res.status(409).json({ error: 'This match is over. The watch link now shows the result and the match video.' });
  const title = s.battingTeam && s.bowlingTeam ? `${s.battingTeam} vs ${s.bowlingTeam}` : `CricScore match ${code}`;
  try {
    const r = await fetch(`${target}/stream/api/integrations/cricscore/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ matchCode: code, title }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(502).json({ error: data.error || 'Camera streaming service refused the request' });
    const base = publicBase(req);
    res.json({
      roomId: data.roomId,
      studioUrl: `${base}/stream/host?token=${encodeURIComponent(data.hostToken)}`,
      // Permanent per-match link: follows the current camera room and plays the full match afterwards
      watchUrl: `${base}/stream/match/${code}`,
    });
  } catch {
    res.status(502).json({ error: 'Camera streaming is not running. Start it with server/scripts/go-live.sh' });
  }
});

// GET /live/:code/overlay -> public score summary (no token: shows score only)
router.get('/:code/overlay', (req, res) => {
  const sess = getSession(req, res);
  if (!sess) return;
  res.set('Cache-Control', 'no-store');
  res.json(summarize(sess));
});

module.exports = router;
