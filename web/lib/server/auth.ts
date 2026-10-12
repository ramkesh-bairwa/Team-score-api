// Website login: mobile number + PIN (new numbers verify once and create their PIN), users and cookie sessions.
// There is no SMS provider, so the OTP is shown on screen and can't prove who owns a number: the PIN is what
// keeps an account to its owner. An account's mobile number and name never change after it is created.
// STORAGE=mysql  -> MySQL tables web_users / web_sessions / web_otps (+ web_auth_meta for the OTP secret)
// otherwise      -> one JSON file, DATA_DIR/web-auth.json (atomic writes)
// Used only by /api/auth/* — the mobile app's API never touches this module.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { once } from './state';

export const SESSION_COOKIE = 'cs_session';
export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;
export const OTP_TTL_S = 300;
const OTP_RESEND_S = 30;
const OTP_PER_HOUR = 5;
const OTP_MAX_ATTEMPTS = 5;
const HOUR = 60 * 60 * 1000;

const USE_MYSQL = process.env.STORAGE === 'mysql';
const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const AUTH_FILE = path.join(DATA_DIR, 'web-auth.json');

export type User = { id: string; mobile: string; name: string; createdAt: number; lastLoginAt: number; pinHash?: string };
type Session = { tokenHash: string; userId: string; createdAt: number; expiresAt: number };
type Otp = { mobile: string; hash: string; expiresAt: number; attempts: number; lastSentAt: number; sentLog: number[] };

type Backend = {
  secret(): Promise<string>;
  userByMobile(mobile: string): Promise<User | null>;
  userById(id: string): Promise<User | null>;
  saveUser(u: User): Promise<void>;
  getOtp(mobile: string): Promise<Otp | null>;
  saveOtp(o: Otp): Promise<void>;
  getSession(tokenHash: string): Promise<Session | null>;
  saveSession(s: Session): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  purgeExpired(now: number): Promise<void>;
};

// ─── MySQL ────────────────────────────────────────────────

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS web_users (
    id VARCHAR(64) PRIMARY KEY,
    mobile VARCHAR(16) NOT NULL,
    name VARCHAR(80) NOT NULL,
    created_at BIGINT NOT NULL,
    last_login_at BIGINT NOT NULL,
    UNIQUE KEY uq_web_users_mobile (mobile)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS web_sessions (
    token_hash CHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    KEY idx_web_sessions_user (user_id),
    KEY idx_web_sessions_expires (expires_at)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS web_otps (
    mobile VARCHAR(16) PRIMARY KEY,
    otp_hash CHAR(64) NOT NULL,
    expires_at BIGINT NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    last_sent_at BIGINT NOT NULL,
    sent_log JSON NOT NULL
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS web_auth_meta (
    k VARCHAR(64) PRIMARY KEY,
    v VARCHAR(255) NOT NULL
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
];

const conn = once('authPool', () => ({ pool: null as mysql.Pool | null, ready: null as Promise<void> | null }));

const db = async (): Promise<mysql.Pool> => {
  if (!conn.pool) {
    conn.pool = mysql.createPool({
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
  if (!conn.ready) {
    const pool = conn.pool;
    conn.ready = (async () => {
      for (const sql of SCHEMA) await pool.query(sql);
      // PIN column for tables made before PINs existed (already there -> MySQL error 1060, ignored)
      await pool.query('ALTER TABLE web_users ADD COLUMN pin_hash VARCHAR(200) NULL').catch((e: any) => {
        if (e?.errno !== 1060) throw e;
      });
    })().catch(e => { conn.ready = null; throw e; });
  }
  await conn.ready;
  return conn.pool;
};

const rows = async (sql: string, args: any[] = []): Promise<any[]> => {
  const [r] = await (await db()).query(sql, args);
  return r as any[];
};
const exec = async (sql: string, args: any[] = []) => { await (await db()).query(sql, args); };
const parse = (v: any) => (typeof v === 'string' ? JSON.parse(v) : v);

const userRow = (r: any): User => ({
  id: r.id, mobile: r.mobile, name: r.name, createdAt: Number(r.created_at), lastLoginAt: Number(r.last_login_at),
  pinHash: r.pin_hash || undefined,
});

const mysqlBackend: Backend = {
  async secret() {
    const found = await rows('SELECT v FROM web_auth_meta WHERE k = ?', ['otp_secret']);
    if (found[0]) return found[0].v;
    // INSERT IGNORE + re-read, so two processes starting together agree on one secret
    await exec('INSERT IGNORE INTO web_auth_meta (k, v) VALUES (?, ?)', ['otp_secret', crypto.randomBytes(32).toString('hex')]);
    return (await rows('SELECT v FROM web_auth_meta WHERE k = ?', ['otp_secret']))[0].v;
  },
  async userByMobile(mobile) {
    const r = await rows('SELECT * FROM web_users WHERE mobile = ?', [mobile]);
    return r[0] ? userRow(r[0]) : null;
  },
  async userById(id) {
    const r = await rows('SELECT * FROM web_users WHERE id = ?', [id]);
    return r[0] ? userRow(r[0]) : null;
  },
  async saveUser(u) {
    await exec(
      `INSERT INTO web_users (id, mobile, name, created_at, last_login_at, pin_hash) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE last_login_at = VALUES(last_login_at), pin_hash = COALESCE(pin_hash, VALUES(pin_hash))`,
      [u.id, u.mobile, u.name, u.createdAt, u.lastLoginAt, u.pinHash || null],
    );
  },
  async getOtp(mobile) {
    const r = (await rows('SELECT * FROM web_otps WHERE mobile = ?', [mobile]))[0];
    if (!r) return null;
    return {
      mobile: r.mobile, hash: r.otp_hash, expiresAt: Number(r.expires_at), attempts: Number(r.attempts),
      lastSentAt: Number(r.last_sent_at), sentLog: (parse(r.sent_log) || []).map(Number),
    };
  },
  async saveOtp(o) {
    await exec(
      `INSERT INTO web_otps (mobile, otp_hash, expires_at, attempts, last_sent_at, sent_log) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE otp_hash = VALUES(otp_hash), expires_at = VALUES(expires_at), attempts = VALUES(attempts),
         last_sent_at = VALUES(last_sent_at), sent_log = VALUES(sent_log)`,
      [o.mobile, o.hash, o.expiresAt, o.attempts, o.lastSentAt, JSON.stringify(o.sentLog)],
    );
  },
  async getSession(tokenHash) {
    const r = (await rows('SELECT * FROM web_sessions WHERE token_hash = ?', [tokenHash]))[0];
    return r ? { tokenHash: r.token_hash, userId: r.user_id, createdAt: Number(r.created_at), expiresAt: Number(r.expires_at) } : null;
  },
  async saveSession(s) {
    await exec('INSERT INTO web_sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      [s.tokenHash, s.userId, s.createdAt, s.expiresAt]);
  },
  async deleteSession(tokenHash) {
    await exec('DELETE FROM web_sessions WHERE token_hash = ?', [tokenHash]);
  },
  async purgeExpired(now) {
    await exec('DELETE FROM web_sessions WHERE expires_at < ?', [now]);
    await exec('DELETE FROM web_otps WHERE last_sent_at < ? AND expires_at < ?', [now - HOUR, now]);
  },
};

// ─── JSON file ────────────────────────────────────────────

type FileData = {
  secret: string;
  users: Record<string, User>;
  sessions: Record<string, Session>;
  otps: Record<string, Otp>;
};

const writeAtomic = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
};

const fileData = once('webAuthFile', (): FileData => {
  let d: Partial<FileData> = {};
  try { d = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch { /* first start */ }
  return { secret: d.secret || '', users: d.users || {}, sessions: d.sessions || {}, otps: d.otps || {} };
});
const persist = () => writeAtomic(AUTH_FILE, fileData);

const fileBackend: Backend = {
  async secret() {
    if (!fileData.secret) { fileData.secret = crypto.randomBytes(32).toString('hex'); persist(); }
    return fileData.secret;
  },
  async userByMobile(mobile) { return Object.values(fileData.users).find(u => u.mobile === mobile) || null; },
  async userById(id) { return fileData.users[id] || null; },
  async saveUser(u) { fileData.users[u.id] = { ...u }; persist(); },
  async getOtp(mobile) { const o = fileData.otps[mobile]; return o ? { ...o, sentLog: [...o.sentLog] } : null; },
  async saveOtp(o) { fileData.otps[o.mobile] = o; persist(); },
  async getSession(tokenHash) { return fileData.sessions[tokenHash] || null; },
  async saveSession(s) { fileData.sessions[s.tokenHash] = s; persist(); },
  async deleteSession(tokenHash) {
    if (fileData.sessions[tokenHash]) { delete fileData.sessions[tokenHash]; persist(); }
  },
  async purgeExpired(now) {
    let changed = false;
    for (const [k, s] of Object.entries(fileData.sessions)) if (s.expiresAt < now) { delete fileData.sessions[k]; changed = true; }
    for (const [k, o] of Object.entries(fileData.otps)) {
      if (o.lastSentAt < now - HOUR && o.expiresAt < now) { delete fileData.otps[k]; changed = true; }
    }
    if (changed) persist();
  },
};

const store: Backend = USE_MYSQL ? mysqlBackend : fileBackend;

// ─── Logic ────────────────────────────────────────────────

export class AuthError extends Error {
  constructor(public status: number, public body: Record<string, unknown>) {
    super(String(body.error));
  }
}

const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const otpSecret = async () => process.env.AUTH_SECRET || store.secret();
const otpHash = async (mobile: string, otp: string) => sha256(`${await otpSecret()}:${mobile}:${otp}`);
const sameHash = (a: string, b: string) =>
  a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

const purgeState = once('webAuthPurge', () => ({ last: 0 }));
const maybePurge = (now: number) => {
  if (now - purgeState.last < 10 * 60 * 1000) return;
  purgeState.last = now;
  store.purgeExpired(now).catch(e => console.error('auth purge:', e?.message));
};

/** 10-digit Indian mobile (spaces, dashes, brackets, +91 / 91 / 0 prefix allowed) → "9876543210", else null. */
export function normaliseMobile(input: unknown): string | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  let d = String(input).trim();
  if (!/^\+?[\d\s\-().]+$/.test(d)) return null;
  d = d.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

const cleanName = (input: unknown) => (typeof input === 'string' ? input.replace(/\s+/g, ' ').trim() : '');
const validName = (name: string) => name.length >= 2 && name.length <= 40;

const badMobile = () => new AuthError(400, { error: 'Enter a valid 10-digit mobile number' });

// ─── PIN ──────────────────────────────────────────────────
const PIN_RE = /^\d{4,6}$/;
const cleanPin = (input: unknown) => (typeof input === 'string' || typeof input === 'number' ? String(input).trim() : '');
const hashPin = (pin: string) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pin, salt, 32).toString('hex')}`;
};
const pinMatches = (pin: string, stored: string) => {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  return sameHash(crypto.scryptSync(pin, salt, 32).toString('hex'), hash);
};
// Wrong PINs lock the number for a while: 5 wrong -> 15 min, every 5 more -> 24 h
const pinFails = once('webPinFails', () => new Map<string, { count: number; until: number }>());
const checkPinLock = (mobile: string, now: number) => {
  const f = pinFails.get(mobile);
  if (f && f.until > now) {
    const mins = Math.ceil((f.until - now) / 60000);
    throw new AuthError(429, { error: `Too many wrong PINs. Try again in ${mins >= 60 ? `${Math.ceil(mins / 60)} h` : `${mins} min`}`, locked: true });
  }
};
const notePinFail = (mobile: string, now: number) => {
  const f = pinFails.get(mobile) || { count: 0, until: 0 };
  f.count += 1;
  if (f.count % 5 === 0) f.until = now + (f.count >= 10 ? 24 * HOUR : 15 * 60 * 1000);
  pinFails.set(mobile, f);
  return f.count % 5 === 0 ? 0 : 5 - (f.count % 5);
};

const startSession = async (user: User, now: number) => {
  const token = crypto.randomBytes(32).toString('hex');
  // Only a hash of the token is stored, so a leaked store can't be replayed as cookies
  await store.saveSession({ tokenHash: sha256(token), userId: user.id, createdAt: now, expiresAt: now + SESSION_MS });
  return { token, user: publicUser(user) };
};

/** Mobile + PIN -> session (accounts that have a PIN). */
export async function loginWithPin(input: { mobile?: unknown; pin?: unknown }) {
  const mobile = normaliseMobile(input?.mobile);
  if (!mobile) throw badMobile();
  const now = Date.now();
  checkPinLock(mobile, now);
  const user = await store.userByMobile(mobile);
  if (!user || !user.pinHash) throw new AuthError(400, { error: 'This number has no PIN yet. Continue with the code.', noPin: true });
  const pin = cleanPin(input?.pin);
  if (!PIN_RE.test(pin) || !pinMatches(pin, user.pinHash)) {
    const attemptsLeft = notePinFail(mobile, now);
    throw new AuthError(400, attemptsLeft ? { error: 'Wrong PIN', attemptsLeft } : { error: 'Wrong PIN. Try again in 15 min', locked: true });
  }
  pinFails.delete(mobile);
  const updated = { ...user, lastLoginAt: now };
  await store.saveUser(updated);
  return startSession(updated, now);
}

export async function requestOtp(input: { mobile?: unknown; name?: unknown }) {
  const mobile = normaliseMobile(input?.mobile);
  if (!mobile) throw badMobile();
  const now = Date.now();
  maybePurge(now);

  const owner = await store.userByMobile(mobile);
  if (owner?.pinHash) return { success: true, hasPin: true, isNewUser: false };

  const prev = await store.getOtp(mobile);
  const sentLog = (prev?.sentLog || []).filter(t => t > now - HOUR);
  if (prev && now - prev.lastSentAt < OTP_RESEND_S * 1000) {
    const retryIn = Math.ceil((prev.lastSentAt + OTP_RESEND_S * 1000 - now) / 1000);
    throw new AuthError(429, { error: `Please wait ${retryIn}s before asking for a new OTP`, retryIn });
  }
  if (sentLog.length >= OTP_PER_HOUR) {
    const retryIn = Math.ceil((Math.min(...sentLog) + HOUR - now) / 1000);
    throw new AuthError(429, { error: `Too many OTP requests. Try again in ${Math.ceil(retryIn / 60)} min`, retryIn });
  }

  const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  await store.saveOtp({
    mobile,
    hash: await otpHash(mobile, otp),
    expiresAt: now + OTP_TTL_S * 1000,
    attempts: 0,
    lastSentAt: now,
    sentLog: [...sentLog, now],
  });
  const isNewUser = !owner;
  // No SMS provider yet: the OTP goes back to the page, which shows it on screen
  return { success: true, otp, expiresIn: OTP_TTL_S, isNewUser, hasPin: false };
}

export async function verifyOtp(input: { mobile?: unknown; otp?: unknown; name?: unknown; pin?: unknown }) {
  const mobile = normaliseMobile(input?.mobile);
  if (!mobile) throw badMobile();
  const now = Date.now();
  const existing = await store.userByMobile(mobile);
  if (existing?.pinHash) throw new AuthError(400, { error: 'This account has a PIN. Log in with your PIN.', hasPin: true });
  const name = cleanName(input?.name);
  if (!existing && !name) throw new AuthError(400, { error: 'Enter your name', needName: true });
  if (!existing && !validName(name)) throw new AuthError(400, { error: 'Name must be 2–40 characters', needName: true });
  const pin = cleanPin((input as any)?.pin);
  if (!PIN_RE.test(pin)) throw new AuthError(400, { error: 'Create a 4–6 digit PIN', needPin: true });

  const code = typeof input?.otp === 'string' || typeof input?.otp === 'number' ? String(input.otp).replace(/\s/g, '') : '';
  if (!/^\d{6}$/.test(code)) throw new AuthError(400, { error: 'Enter the 6-digit OTP' });

  const otp = await store.getOtp(mobile);
  if (!otp || !otp.hash) throw new AuthError(400, { error: 'Request an OTP first', expired: true });
  if (otp.expiresAt < now) throw new AuthError(400, { error: 'OTP expired. Request a new one', expired: true });
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    throw new AuthError(400, { error: 'Too many wrong attempts. Request a new OTP', expired: true, attemptsLeft: 0 });
  }

  if (!sameHash(otp.hash, await otpHash(mobile, code))) {
    otp.attempts += 1;
    await store.saveOtp(otp);
    const attemptsLeft = Math.max(0, OTP_MAX_ATTEMPTS - otp.attempts);
    throw new AuthError(400, attemptsLeft
      ? { error: 'Wrong OTP', attemptsLeft }
      : { error: 'Wrong OTP', attemptsLeft, expired: true });
  }

  // One OTP, one login: burn it (keep the send log for rate limiting)
  await store.saveOtp({ ...otp, hash: '', expiresAt: 0, attempts: OTP_MAX_ATTEMPTS });

  const user: User = existing
    ? { ...existing, lastLoginAt: now, pinHash: hashPin(pin) }
    : { id: crypto.randomUUID(), mobile, name, createdAt: now, lastLoginAt: now, pinHash: hashPin(pin) };
  await store.saveUser(user);
  return startSession(user, now);
}

export const publicUser = (u: User) => ({ id: u.id, name: u.name, mobile: u.mobile });

export async function userForToken(token: string | null | undefined) {
  if (!token || !/^[0-9a-f]{64}$/.test(token)) return null;
  const s = await store.getSession(sha256(token));
  if (!s) return null;
  if (s.expiresAt < Date.now()) { await store.deleteSession(s.tokenHash); return null; }
  const u = await store.userById(s.userId);
  return u ? publicUser(u) : null;
}

export async function logout(token: string | null | undefined) {
  if (token && /^[0-9a-f]{64}$/.test(token)) await store.deleteSession(sha256(token));
}

// ─── HTTP helpers for the route handlers ──────────────────

export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    if (part.slice(0, i).trim() === SESSION_COOKIE) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; }
    }
  }
  return null;
}

const isHttps = (request: Request) => {
  const fwd = request.headers.get('x-forwarded-proto');
  if (fwd) return fwd.split(',')[0].trim().toLowerCase() === 'https';
  try { return new URL(request.url).protocol === 'https:'; } catch { return false; }
};

export function sessionCookie(request: Request, token: string | null) {
  const parts = [
    `${SESSION_COOKIE}=${token ?? ''}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${token ? SESSION_MS / 1000 : 0}`,
  ];
  if (!token) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (isHttps(request)) parts.push('Secure');
  return parts.join('; ');
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

export async function readBody(request: Request): Promise<any> {
  try {
    const b = await request.json();
    return b && typeof b === 'object' ? b : {};
  } catch {
    return {};
  }
}

/** Runs an auth handler, turning AuthError into its JSON response and anything else into a 500. */
export async function handleAuth(fn: () => Promise<Response>) {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AuthError) return json(e.status, e.body);
    console.error('auth error:', (e as Error)?.message || e);
    return json(500, { error: 'Something went wrong. Please try again.' });
  }
}
