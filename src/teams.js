const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();

// Shared teams, visible to every app user. Stored in a JSON file so it works without MySQL
// (set TEAMS_FILE to put it on a persistent disk).
const FILE = process.env.TEAMS_FILE || path.join(__dirname, '..', 'data', 'teams.json');
const MAX_PLAYERS = 11;
const ROLES = ['Batter', 'Bowler', 'All-Rounder', 'Captain', 'Keeper', 'Impact Player'];

let teams = [];
try {
  teams = JSON.parse(fs.readFileSync(FILE, 'utf8'));
} catch (_) {
  teams = [];
}

const save = () => {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(teams, null, 2));
  fs.renameSync(tmp, FILE);
};

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
router.get('/', (req, res) => {
  const q = clean(req.query.search, 40).toLowerCase();
  const me = clean(req.query.deviceId, 64);
  const list = teams
    .filter(t => !q || t.name.toLowerCase().includes(q) || t.players.some(p => p.name.toLowerCase().includes(q)))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(t => publicTeam(t, me));
  res.json(list);
});

// POST /shared-teams  { name, players, createdBy, deviceId }
router.post('/', (req, res) => {
  const { team, error } = parseTeam(req.body || {});
  if (error) return res.status(400).json({ error });
  if (teams.some(t => t.name.toLowerCase() === team.name.toLowerCase())) {
    return res.status(409).json({ error: `A team named "${team.name}" already exists. Pick it from the list or use another name.` });
  }
  const now = Date.now();
  const record = {
    id: crypto.randomUUID(), ...team,
    createdBy: clean(req.body.createdBy, 40) || 'Unknown',
    deviceId: clean(req.body.deviceId, 64),
    createdAt: now, updatedAt: now,
  };
  teams.push(record);
  save();
  res.json(publicTeam(record, record.deviceId));
});

// PUT /shared-teams/:id  -> only the phone that created the team can edit it
router.put('/:id', (req, res) => {
  const idx = teams.findIndex(t => t.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Team not found' });
  if (!req.body?.deviceId || teams[idx].deviceId !== req.body.deviceId) {
    return res.status(403).json({ error: 'Only the person who created this team can edit it' });
  }
  const { team, error } = parseTeam(req.body);
  if (error) return res.status(400).json({ error });
  if (teams.some((t, i) => i !== idx && t.name.toLowerCase() === team.name.toLowerCase())) {
    return res.status(409).json({ error: `A team named "${team.name}" already exists` });
  }
  teams[idx] = { ...teams[idx], ...team, updatedAt: Date.now() };
  save();
  res.json(publicTeam(teams[idx], teams[idx].deviceId));
});

// DELETE /shared-teams/:id?deviceId=  -> creator only
router.delete('/:id', (req, res) => {
  const idx = teams.findIndex(t => t.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Team not found' });
  if (!req.query.deviceId || teams[idx].deviceId !== req.query.deviceId) {
    return res.status(403).json({ error: 'Only the person who created this team can delete it' });
  }
  teams.splice(idx, 1);
  save();
  res.json({ success: true });
});

module.exports = router;
