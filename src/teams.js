const express = require('express');
const crypto = require('crypto');
const store = require('./store');
const router = express.Router();

// Shared teams, visible to every app user (MySQL on the server, JSON file locally — see store.js)
const MAX_PLAYERS = 11;
const ROLES = ['Batter', 'Bowler', 'All-Rounder', 'Captain', 'Keeper', 'Impact Player'];

// Async handlers: answer with a JSON error instead of crashing on a storage failure
const wrap = fn => (req, res) => fn(req, res).catch(e => {
  console.error('teams:', e.message);
  res.status(500).json({ error: 'Server storage error, please try again' });
});
const nameTaken = (teams, name, exceptId) =>
  teams.some(t => t.id !== exceptId && t.name.toLowerCase() === name.toLowerCase());

const clean = (s, max) => String(s || '').trim().slice(0, max);

// Validates and normalizes a team body; returns { team } or { error }
const parseTeam = (body) => {
  const name = clean(body.name, 40);
  if (!name) return { error: 'Team name is required' };
  const seen = new Set();
  const players = [];
  for (const p of Array.isArray(body.players) ? body.players : []) {
    const pname = clean(p && p.name, 40);
    if (!pname || seen.has(pname.toLowerCase())) continue;
    seen.add(pname.toLowerCase());
    const mobile = clean(p.mobile, 15).replace(/[\s-]/g, '');
    players.push({
      name: pname,
      nickname: clean(p.nickname, 30) || undefined,
      mobile: /^\+?\d{10,13}$/.test(mobile) ? mobile : undefined,
      roles: (Array.isArray(p.roles) ? p.roles : []).filter(r => ROLES.includes(r)),
    });
  }
  if (players.length < 2) return { error: 'Add at least 2 players' };
  if (players.length > MAX_PLAYERS) return { error: `A team can have at most ${MAX_PLAYERS} players` };
  const captain = players.find(p => p.roles.includes('Captain'))?.name || players[0].name;
  return { team: { name, players, captain } };
};

// deviceId is never sent back; `mine` tells the caller whether they can edit/delete it
const publicTeam = ({ deviceId, ...t }, me) => ({ ...t, mine: !!me && deviceId === me });

// GET /shared-teams?search=&deviceId=  -> newest first
router.get('/', wrap(async (req, res) => {
  const q = clean(req.query.search, 40).toLowerCase();
  const me = clean(req.query.deviceId, 64);
  const list = (await store.teams.list())
    .filter(t => !q || t.name.toLowerCase().includes(q) || t.players.some(p => p.name.toLowerCase().includes(q)))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(t => publicTeam(t, me));
  res.json(list);
}));

// POST /shared-teams  { name, players, createdBy, deviceId }
router.post('/', wrap(async (req, res) => {
  const { team, error } = parseTeam(req.body || {});
  if (error) return res.status(400).json({ error });
  if (nameTaken(await store.teams.list(), team.name)) {
    return res.status(409).json({ error: `A team named "${team.name}" already exists. Pick it from the list or use another name.` });
  }
  const now = Date.now();
  const record = {
    id: crypto.randomUUID(), ...team,
    createdBy: clean(req.body.createdBy, 40) || 'Unknown',
    deviceId: clean(req.body.deviceId, 64),
    createdAt: now, updatedAt: now,
  };
  await store.teams.save(record);
  res.json(publicTeam(record, record.deviceId));
}));

// PUT /shared-teams/:id  -> only the phone that created the team can edit it
router.put('/:id', wrap(async (req, res) => {
  const existing = await store.teams.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Team not found' });
  if (!req.body?.deviceId || existing.deviceId !== req.body.deviceId) {
    return res.status(403).json({ error: 'Only the person who created this team can edit it' });
  }
  const { team, error } = parseTeam(req.body);
  if (error) return res.status(400).json({ error });
  if (nameTaken(await store.teams.list(), team.name, existing.id)) {
    return res.status(409).json({ error: `A team named "${team.name}" already exists` });
  }
  const updated = { ...existing, ...team, updatedAt: Date.now() };
  await store.teams.save(updated);
  res.json(publicTeam(updated, updated.deviceId));
}));

// DELETE /shared-teams/:id?deviceId=  -> creator only
router.delete('/:id', wrap(async (req, res) => {
  const existing = await store.teams.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Team not found' });
  if (!req.query.deviceId || existing.deviceId !== req.query.deviceId) {
    return res.status(403).json({ error: 'Only the person who created this team can delete it' });
  }
  await store.teams.remove(existing.id);
  res.json({ success: true });
}));

module.exports = router;
