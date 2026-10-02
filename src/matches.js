const express = require('express');
const store = require('./store');
const router = express.Router();

// Matches (MySQL on the server, JSON file locally — see store.js).
// Each match has a client-generated id and a private `key`: the first write sets the key and
// later writes must send it, so only the scoring phone(s) of that match can change it.
const FIELDS = ['team1', 'team2', 'overs', 'matchType', 'location', 'tossWinner', 'tossChoice',
  'bet', 'status', 'innings1', 'innings2', 'result', 'liveCode', 'createdBy'];
const STATUSES = ['live', 'innings_break', 'completed', 'abandoned'];

const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error('matches:', e.message);
  res.status(500).json({ error: 'Server storage error, please try again' });
});

const pub = ({ key, deviceId, ...m }, me) => ({ ...m, mine: !!me && deviceId === me });
const score = (inn) => (inn ? `${inn.runs}/${inn.wickets}` : '');
const oversOf = (inn) => (inn ? `${inn.overs}.${inn.balls}` : '');
const summary = (m, me) => ({
  id: m.id, mine: !!me && m.deviceId === me,
  team1: m.team1?.name || '', team2: m.team2?.name || '',
  overs: m.overs, matchType: m.matchType, location: m.location || '',
  status: m.status, result: m.result || '',
  score: score(m.innings1), oversPlayed: oversOf(m.innings1),
  score2: score(m.innings2), oversPlayed2: oversOf(m.innings2),
  ballType: m.bet?.ballType || '', createdBy: m.createdBy || '',
  createdAt: m.createdAt, updatedAt: m.updatedAt,
});

// GET /v2/matches?deviceId=&mine=1&search=&limit=  -> summaries, newest first
router.get('/', wrap(async (req, res) => {
  const me = String(req.query.deviceId || '');
  const q = String(req.query.search || '').trim().toLowerCase();
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const list = (await store.matches.list())
    .filter(m => req.query.mine !== '1' || (me && m.deviceId === me))
    .filter(m => !q || `${m.team1?.name} ${m.team2?.name} ${m.location || ''}`.toLowerCase().includes(q))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map(m => summary(m, me));
  res.json(list);
}));

// GET /v2/matches/:id -> full match (both innings, ball-by-ball log)
router.get('/:id', wrap(async (req, res) => {
  const m = await store.matches.get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Match not found' });
  res.json(pub(m, String(req.query.deviceId || '')));
}));

// PUT /v2/matches/:id  { key, deviceId, ...fields } -> create, or merge fields into the match
router.put('/:id', wrap(async (req, res) => {
  const id = String(req.params.id);
  const body = req.body || {};
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return res.status(400).json({ error: 'Invalid match id' });
  if (!body.key || String(body.key).length < 16) return res.status(400).json({ error: 'Match key is required' });
  if (body.status && !STATUSES.includes(body.status)) return res.status(400).json({ error: 'Invalid status' });

  const existing = await store.matches.get(id);
  if (existing && existing.key !== body.key) return res.status(403).json({ error: 'Not allowed to change this match' });
  const now = Date.now();
  const fields = {};
  for (const f of FIELDS) if (body[f] !== undefined) fields[f] = body[f];

  const record = existing
    ? { ...existing, ...fields, updatedAt: now }
    : {
      id, key: String(body.key), deviceId: String(body.deviceId || ''),
      status: 'live', ...fields, createdAt: Number(body.createdAt) || now, updatedAt: now,
    };
  if (!record.team1) return res.status(400).json({ error: 'team1 and team2 are required for a new match' });
  await store.matches.save(record);
  res.json(summary(record, String(body.deviceId || '')));
}));

// DELETE /v2/matches/:id?key=
router.delete('/:id', wrap(async (req, res) => {
  const m = await store.matches.get(req.params.id);
  if (!m) return res.status(404).json({ error: 'Match not found' });
  if (m.key !== req.query.key) return res.status(403).json({ error: 'Not allowed to delete this match' });
  await store.matches.remove(m.id);
  res.json({ success: true });
}));

module.exports = router;
