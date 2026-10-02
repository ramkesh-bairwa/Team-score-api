// Storage for shared teams and matches.
// STORAGE=mysql  -> MySQL tables (used on the production server, browsable in phpMyAdmin)
// otherwise      -> JSON files in data/ (local development, no database needed)
const fs = require('fs');
const path = require('path');

const USE_MYSQL = process.env.STORAGE === 'mysql';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const TEAMS_FILE = process.env.TEAMS_FILE || path.join(DATA_DIR, 'teams.json');
const MATCHES_FILE = process.env.MATCHES_FILE || path.join(DATA_DIR, 'matches.json');

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
};

// ─── MySQL ────────────────────────────────────────────────

let pool = null;
let ready = null;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS shared_teams (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(80) NOT NULL,
    captain VARCHAR(80),
    player_count INT NOT NULL DEFAULT 0,
    players JSON NOT NULL,
    created_by VARCHAR(80),
    device_id VARCHAR(80),
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    UNIQUE KEY uq_team_name (name)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS matches (
    id VARCHAR(64) PRIMARY KEY,
    edit_key VARCHAR(80) NOT NULL,
    device_id VARCHAR(80),
    team1_name VARCHAR(80),
    team2_name VARCHAR(80),
    status VARCHAR(20),
    result VARCHAR(200),
    overs INT,
    match_type VARCHAR(20),
    ball_type VARCHAR(20),
    location VARCHAR(120),
    score1 VARCHAR(20),
    score2 VARCHAR(20),
    live_code VARCHAR(12),
    data JSON NOT NULL,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL,
    KEY idx_device (device_id),
    KEY idx_created (created_at)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
];

const parse = v => (typeof v === 'string' ? JSON.parse(v) : v);
const score = inn => (inn ? `${inn.runs}/${inn.wickets}` : null);

// Writes take the pool explicitly so the first-start import can use them before `ready` resolves
const saveTeamRow = (p, t) => p.query(
  `INSERT INTO shared_teams (id, name, captain, player_count, players, created_by, device_id, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON DUPLICATE KEY UPDATE name = VALUES(name), captain = VALUES(captain), player_count = VALUES(player_count),
     players = VALUES(players), updated_at = VALUES(updated_at)`,
  [t.id, t.name, t.captain, t.players.length, JSON.stringify(t.players), t.createdBy, t.deviceId, t.createdAt, t.updatedAt],
);

const saveMatchRow = (p, m) => {
  const { key, deviceId, ...data } = m;
  return p.query(
    `INSERT INTO matches (id, edit_key, device_id, team1_name, team2_name, status, result, overs, match_type, ball_type,
       location, score1, score2, live_code, data, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE team1_name = VALUES(team1_name), team2_name = VALUES(team2_name), status = VALUES(status),
       result = VALUES(result), overs = VALUES(overs), match_type = VALUES(match_type), ball_type = VALUES(ball_type),
       location = VALUES(location), score1 = VALUES(score1), score2 = VALUES(score2), live_code = VALUES(live_code),
       data = VALUES(data), updated_at = VALUES(updated_at)`,
    [m.id, key, deviceId, m.team1?.name || null, m.team2?.name || null, m.status || null, m.result || null,
      Number(m.overs) || null, m.matchType || null, m.bet?.ballType || null, m.location || null,
      score(m.innings1), score(m.innings2), m.liveCode || null, JSON.stringify(data), m.createdAt, m.updatedAt],
  );
};

// First start on MySQL: bring over anything saved earlier in the JSON files
async function importJsonOnce() {
  const [[{ n: teamCount }]] = await pool.query('SELECT COUNT(*) AS n FROM shared_teams');
  if (!Number(teamCount)) {
    for (const t of readJson(TEAMS_FILE, [])) await saveTeamRow(pool, t).catch(e => console.error('import team:', e.message));
  }
  const [[{ n: matchCount }]] = await pool.query('SELECT COUNT(*) AS n FROM matches');
  if (!Number(matchCount)) {
    for (const m of Object.values(readJson(MATCHES_FILE, {}))) await saveMatchRow(pool, m).catch(e => console.error('import match:', e.message));
  }
}

const db = async () => {
  if (!pool) {
    const mysql = require('mysql2/promise');
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: Number(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE || 'cricscore',
      waitForConnections: true,
      connectionLimit: 10,
      charset: 'utf8mb4',
    });
  }
  if (!ready) {
    ready = (async () => {
      for (const sql of SCHEMA) await pool.query(sql);
      await importJsonOnce();
    })().catch(e => { ready = null; throw e; });
  }
  await ready;
  return pool;
};

const teamRow = r => ({
  id: r.id, name: r.name, players: parse(r.players), captain: r.captain,
  createdBy: r.created_by, deviceId: r.device_id, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
});
const matchRow = r => ({ ...parse(r.data), id: r.id, key: r.edit_key, deviceId: r.device_id });

const mysqlTeams = {
  list: async () => (await (await db()).query('SELECT * FROM shared_teams'))[0].map(teamRow),
  get: async id => {
    const [rows] = await (await db()).query('SELECT * FROM shared_teams WHERE id = ?', [id]);
    return rows[0] ? teamRow(rows[0]) : null;
  },
  save: async t => { await saveTeamRow(await db(), t); },
  remove: async id => { await (await db()).query('DELETE FROM shared_teams WHERE id = ?', [id]); },
};

const mysqlMatches = {
  list: async () => (await (await db()).query('SELECT * FROM matches ORDER BY created_at DESC'))[0].map(matchRow),
  get: async id => {
    const [rows] = await (await db()).query('SELECT * FROM matches WHERE id = ?', [id]);
    return rows[0] ? matchRow(rows[0]) : null;
  },
  save: async m => { await saveMatchRow(await db(), m); },
  remove: async id => { await (await db()).query('DELETE FROM matches WHERE id = ?', [id]); },
};

// ─── JSON files ───────────────────────────────────────────

const writeAtomic = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
};

const teamsFile = readJson(TEAMS_FILE, []);
const matchesFile = readJson(MATCHES_FILE, {});

const fileTeams = {
  list: async () => teamsFile,
  get: async id => teamsFile.find(t => t.id === id) || null,
  save: async t => {
    const i = teamsFile.findIndex(x => x.id === t.id);
    if (i >= 0) teamsFile[i] = t; else teamsFile.push(t);
    writeAtomic(TEAMS_FILE, teamsFile);
  },
  remove: async id => {
    const i = teamsFile.findIndex(x => x.id === id);
    if (i >= 0) teamsFile.splice(i, 1);
    writeAtomic(TEAMS_FILE, teamsFile);
  },
};

const fileMatches = {
  list: async () => Object.values(matchesFile).sort((a, b) => b.createdAt - a.createdAt),
  get: async id => matchesFile[id] || null,
  save: async m => { matchesFile[m.id] = m; writeAtomic(MATCHES_FILE, matchesFile); },
  remove: async id => { delete matchesFile[id]; writeAtomic(MATCHES_FILE, matchesFile); },
};

module.exports = {
  mode: USE_MYSQL ? 'mysql' : 'file',
  teams: USE_MYSQL ? mysqlTeams : fileTeams,
  matches: USE_MYSQL ? mysqlMatches : fileMatches,
};
