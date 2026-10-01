const express = require('express');
const { v4: uuid } = require('uuid');
const { query } = require('./db');
const router = express.Router();

// ─── TEAMS ───────────────────────────────────────────────
// POST /teams
router.post('/teams', async (req, res) => {
  try {
    const { name } = req.body;
    const id = uuid();
    await query('INSERT INTO teams (id, name) VALUES (?, ?)', [id, name]);
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /teams
router.get('/teams', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM teams ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /teams/:id
router.get('/teams/:id', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM teams WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── PLAYERS ─────────────────────────────────────────────
// POST /players
router.post('/players', async (req, res) => {
  try {
    const { team_id, name, nickname, mobile, photo, roles } = req.body;
    const id = uuid();
    await query(
      'INSERT INTO players (id, team_id, name, nickname, mobile, photo, roles) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, team_id, name, nickname || null, mobile || null, photo || null, JSON.stringify(roles || [])]
    );
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /players?team_id=xxx&search=name
router.get('/players', async (req, res) => {
  try {
    const { team_id, search } = req.query;
    let rows;
    if (search) {
      rows = await query('SELECT * FROM players WHERE name LIKE ?', [`%${search}%`]);
    } else if (team_id) {
      rows = await query('SELECT * FROM players WHERE team_id = ?', [team_id]);
    } else {
      rows = await query('SELECT * FROM players');
    }
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── MATCHES ─────────────────────────────────────────────
// POST /matches
router.post('/matches', async (req, res) => {
  try {
    const {
      team1_id, team2_id, team1_name, team2_name,
      overs, match_type, toss_winner, toss_choice,
      bet_type, bet_amount, cap1_photo, cap2_photo,
    } = req.body;
    const id = uuid();
    await query(
      `INSERT INTO matches
        (id, team1_id, team2_id, team1_name, team2_name, overs, match_type,
         toss_winner, toss_choice, bet_type, bet_amount, cap1_photo, cap2_photo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, team1_id || null, team2_id || null, team1_name, team2_name,
       overs, match_type || 'local', toss_winner, toss_choice,
       bet_type || 'free', bet_amount || 0, cap1_photo || null, cap2_photo || null]
    );
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /matches
router.get('/matches', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM matches ORDER BY created_at DESC');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /matches/:id
router.get('/matches/:id', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM matches WHERE id = ?', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /matches/:id/complete
router.patch('/matches/:id/complete', async (req, res) => {
  try {
    const { result } = req.body;
    await query('UPDATE matches SET status = ?, result = ? WHERE id = ?', ['completed', result || '', req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── INNINGS ─────────────────────────────────────────────
// POST /innings
router.post('/innings', async (req, res) => {
  try {
    const {
      match_id, innings_number, batting_team_id, bowling_team_id,
      batting_team_name, total_runs, total_wickets, overs_played, balls_played,
    } = req.body;
    const id = uuid();
    await query(
      `INSERT INTO innings
        (id, match_id, innings_number, batting_team_id, bowling_team_id,
         batting_team_name, total_runs, total_wickets, overs_played, balls_played)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, match_id, innings_number || 1, batting_team_id || null,
       bowling_team_id || null, batting_team_name,
       total_runs || 0, total_wickets || 0, overs_played || 0, balls_played || 0]
    );
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /innings?match_id=xxx
router.get('/innings', async (req, res) => {
  try {
    const { match_id } = req.query;
    const rows = match_id
      ? await query('SELECT * FROM innings WHERE match_id = ?', [match_id])
      : await query('SELECT * FROM innings');
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── BATTING SCORES ──────────────────────────────────────
// POST /batting
router.post('/batting', async (req, res) => {
  try {
    const { innings_id, player_name, runs, balls, fours, sixes, is_out, how_out } = req.body;
    const id = uuid();
    await query(
      'INSERT INTO batting_scores (id, innings_id, player_name, runs, balls, fours, sixes, is_out, how_out) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, innings_id, player_name, runs || 0, balls || 0, fours || 0, sixes || 0, is_out || false, how_out || null]
    );
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /batting?innings_id=xxx
router.get('/batting', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM batting_scores WHERE innings_id = ?', [req.query.innings_id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── BOWLING SCORES ──────────────────────────────────────
// POST /bowling
router.post('/bowling', async (req, res) => {
  try {
    const { innings_id, player_name, overs, balls, runs, wickets } = req.body;
    const id = uuid();
    await query(
      'INSERT INTO bowling_scores (id, innings_id, player_name, overs, balls, runs, wickets) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, innings_id, player_name, overs || 0, balls || 0, runs || 0, wickets || 0]
    );
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /bowling?innings_id=xxx
router.get('/bowling', async (req, res) => {
  try {
    const rows = await query('SELECT * FROM bowling_scores WHERE innings_id = ?', [req.query.innings_id]);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── BALLS ───────────────────────────────────────────────
// POST /balls
router.post('/balls', async (req, res) => {
  try {
    const { innings_id, over_number, ball_number, runs, extra_type, is_wicket, direction, batsman_name, bowler_name } = req.body;
    const id = uuid();
    await query(
      'INSERT INTO balls (id, innings_id, over_number, ball_number, runs, extra_type, is_wicket, direction, batsman_name, bowler_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, innings_id, over_number, ball_number, runs || 0, extra_type || null, is_wicket || false, direction || null, batsman_name || null, bowler_name || null]
    );
    res.json({ success: true, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /balls?innings_id=xxx
router.get('/balls', async (req, res) => {
  try {
    const rows = await query(
      'SELECT * FROM balls WHERE innings_id = ? ORDER BY over_number, ball_number',
      [req.query.innings_id]
    );
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── FULL MATCH DETAIL ───────────────────────────────────
// GET /matches/:id/full
router.get('/matches/:id/full', async (req, res) => {
  try {
    const [match] = await query('SELECT * FROM matches WHERE id = ?', [req.params.id]);
    if (!match) return res.status(404).json({ error: 'Not found' });
    const inningsList = await query('SELECT * FROM innings WHERE match_id = ?', [req.params.id]);
    for (const inn of inningsList) {
      inn.batters = await query('SELECT * FROM batting_scores WHERE innings_id = ?', [inn.id]);
      inn.bowlers = await query('SELECT * FROM bowling_scores WHERE innings_id = ?', [inn.id]);
      inn.balls = await query('SELECT * FROM balls WHERE innings_id = ? ORDER BY over_number, ball_number', [inn.id]);
    }
    res.json({ ...match, innings: inningsList });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
