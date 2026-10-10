// Full-match recordings from the camera phone (/go/:code).
// The phone records what viewers see and sends it here in small pieces while it is live, so a long
// match never has to fit in the phone and nothing is lost if the phone dies. Each recording is one
// file plus a small JSON file next to it:  RECORDINGS_DIR/<code>/<id>.<webm|mp4> + <id>.json
// "Save to YouTube" recordings are stored the same way, then uploaded to the connected channel.
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable, Transform } from 'stream';
import { once } from './state';

export const RECORDINGS_DIR = process.env.RECORDINGS_DIR
  || path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'recordings');
const YT_DIR = path.join(RECORDINGS_DIR, '.youtube');
// A recording nobody has written to for this long is treated as finished (the phone died or left)
const STALE_MS = 15 * 60 * 1000;

export type Target = 'server' | 'youtube';
export type Privacy = 'private' | 'unlisted' | 'public';
export type RecStatus = 'recording' | 'saved' | 'uploading' | 'uploaded' | 'failed';

export interface Recording {
  id: string;
  code: string;
  keyHash: string;
  target: Target;
  mime: string;
  ext: 'webm' | 'mp4';
  title: string;
  privacy: Privacy;
  ytAcct: string | null;
  status: RecStatus;
  bytes: number;
  createdAt: number;
  updatedAt: number;
  youtube: { progress: number; videoId: string | null; error: string | null };
}

const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
const ID_RE = /^[a-f0-9]{16}$/;
const dirOf = (code: string) => path.join(RECORDINGS_DIR, code);
const metaPath = (code: string, id: string) => path.join(dirOf(code), `${id}.json`);
export const filePath = (r: Recording) => path.join(dirOf(r.code), `${r.id}.${r.ext}`);

export function getRecording(code: string, id: string): Recording | null {
  if (!ID_RE.test(id)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath(code, id), 'utf8'));
  } catch {
    return null;
  }
}

const save = (r: Recording) => {
  r.updatedAt = Date.now();
  const p = metaPath(r.code, r.id);
  fs.writeFileSync(`${p}.tmp`, JSON.stringify(r));
  fs.renameSync(`${p}.tmp`, p);
};

const patch = (code: string, id: string, fn: (r: Recording) => void) => {
  const r = getRecording(code, id);
  if (!r) return null;
  fn(r);
  save(r);
  return r;
};

// The camera link's key proves it is the match's camera phone; it is kept with the recording so
// pieces still arrive after a server restart (the in-memory stream room is gone by then)
export const keyMatches = (r: Recording, key: string) => !!key && r.keyHash === hash(key);

export function createRecording(o: { code: string; key: string; target: Target; mime: string; title: string; privacy: Privacy; ytAcct: string | null }): Recording {
  fs.mkdirSync(dirOf(o.code), { recursive: true });
  const r: Recording = {
    id: crypto.randomBytes(8).toString('hex'),
    code: o.code,
    keyHash: hash(o.key),
    target: o.target,
    mime: o.mime,
    ext: o.mime.includes('mp4') ? 'mp4' : 'webm',
    title: o.title,
    privacy: o.privacy,
    ytAcct: o.ytAcct,
    status: 'recording',
    bytes: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    youtube: { progress: 0, videoId: null, error: null },
  };
  fs.writeFileSync(filePath(r), '');
  save(r);
  return r;
}

export function listRecordings(code: string, key: string): Recording[] {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dirOf(code));
  } catch {
    return [];
  }
  return names
    .filter(n => n.endsWith('.json'))
    .map(n => getRecording(code, n.slice(0, -5)))
    .filter((r): r is Recording => !!r && keyMatches(r, key))
    .sort((a, b) => b.createdAt - a.createdAt);
}

// Pieces are appended by byte offset, one at a time per recording. A piece the server already has
// (the phone retried after a lost answer) is accepted again; a gap answers with the size we have.
const appendQueues = once('recAppendQueues', () => new Map<string, Promise<unknown>>());

export function appendPiece(r: Recording, offset: number, data: Buffer): Promise<{ ok: boolean; bytes: number }> {
  const prev = appendQueues.get(r.id) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => {
    const file = filePath(r);
    const size = fs.statSync(file).size;
    if (offset + data.length <= size) return { ok: true, bytes: size };
    if (offset !== size) return { ok: false, bytes: size };
    fs.appendFileSync(file, data);
    const bytes = size + data.length;
    patch(r.code, r.id, x => { x.bytes = bytes; });
    return { ok: true, bytes };
  });
  appendQueues.set(r.id, next);
  next.finally(() => { if (appendQueues.get(r.id) === next) appendQueues.delete(r.id); });
  return next;
}

// A browser recording has no duration in its header, so players can't seek in it. ffmpeg (if the
// server has it) rewrites the header without re-encoding; without ffmpeg the file stays as it is.
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
function fixHeader(r: Recording): Promise<void> {
  const file = filePath(r), tmp = `${file}.fix.${r.ext}`;
  return new Promise<void>(resolve => {
    const p = spawn(FFMPEG, ['-v', 'error', '-y', '-i', file, '-c', 'copy', tmp], { stdio: 'ignore' });
    p.on('error', () => resolve());
    p.on('close', status => {
      try {
        if (status === 0 && fs.statSync(tmp).size > 0) {
          fs.renameSync(tmp, file);
          patch(r.code, r.id, x => { x.bytes = fs.statSync(file).size; });
        }
      } catch {}
      fs.rmSync(tmp, { force: true });
      resolve();
    });
  });
}

// Recording finished: fix its header, then keep it or send it on to YouTube
export function finishRecording(code: string, id: string, privacy?: Privacy) {
  const r = patch(code, id, x => {
    if (x.status === 'recording') x.status = 'saved';
    if (privacy && x.status === 'saved') x.privacy = privacy;
  });
  if (!r || r.status !== 'saved' || !r.bytes) return r;
  // In the append queue, so a late piece can't land while the file is being rewritten
  const prev = appendQueues.get(r.id) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => fixHeader(r));
  appendQueues.set(r.id, next);
  next.then(() => {
    if (appendQueues.get(r.id) === next) appendQueues.delete(r.id);
    if (r.target === 'youtube' && r.ytAcct) startYouTubeUpload(getRecording(code, id)!, r.ytAcct, r.privacy);
  });
  return r;
}

// Recordings left open (phone died / tab closed) are finished after a while, so YouTube ones still upload
once('recSweep', () => setInterval(() => {
  let codes: string[] = [];
  try {
    codes = fs.readdirSync(RECORDINGS_DIR).filter(c => /^[A-Z0-9]{6}$/.test(c));
  } catch {
    return;
  }
  const now = Date.now();
  for (const code of codes) {
    for (const n of fs.readdirSync(dirOf(code)).filter(n => n.endsWith('.json'))) {
      const r = getRecording(code, n.slice(0, -5));
      if (r?.status === 'recording' && now - r.updatedAt > STALE_MS) finishRecording(code, r.id);
      // A server restart in the middle of a YouTube upload: show it as failed so it can be retried
      if (r?.status === 'uploading' && !uploading.has(r.id) && now - r.updatedAt > STALE_MS) {
        patch(code, r.id, x => { x.status = 'failed'; x.youtube.error = 'The upload was interrupted. Try again.'; });
      }
    }
  }
}, 5 * 60 * 1000).unref());

// What the camera phone sees about a recording (no key hash, no YouTube account id)
export const publicView = (r: Recording) => ({
  id: r.id, target: r.target, status: r.status, bytes: r.bytes, ext: r.ext, title: r.title,
  createdAt: r.createdAt, updatedAt: r.updatedAt, youtube: r.youtube,
});

// Opened lazily, so a HEAD request doesn't leave a file handle open
export function fileStream(r: Recording) {
  const file = filePath(r);
  return {
    size: fs.statSync(file).size,
    get body() { return Readable.toWeb(fs.createReadStream(file)) as ReadableStream; },
  };
}

// ─── YouTube ─────────────────────────────────────────────────────────────────
// Google's OAuth device flow ("TVs and Limited Input devices" client), same as the live-stream app:
// the phone shows a short code, the user enters it at google.com/device. No redirect URL needed.
// A connected channel is an "account id" the phone keeps; the refresh token stays here, encrypted.

const OAUTH_BASE = 'https://oauth2.googleapis.com';
const API_BASE = 'https://www.googleapis.com';
const SCOPE = 'https://www.googleapis.com/auth/youtube';

export const youtubeConfigured = () => !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET);
const ACCT_RE = /^[a-f0-9]{32}$/;
export const validAcct = (a: unknown): a is string => typeof a === 'string' && ACCT_RE.test(a);

const cryptKey = () => crypto.createHash('sha256').update(`yt-token:${process.env.YOUTUBE_CLIENT_SECRET}`).digest();
const encrypt = (plain: string) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cryptKey(), iv);
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map(b => b.toString('base64')).join('.');
};
const decrypt = (enc: string) => {
  const [iv, tag, data] = enc.split('.').map(s => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', cryptKey(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString('utf8');
};

type Account = { channelTitle: string; refreshToken: string };
const acctPath = (acct: string) => path.join(YT_DIR, `${acct}.json`);
export function getAccount(acct: string): { channelTitle: string } | null {
  try {
    return { channelTitle: JSON.parse(fs.readFileSync(acctPath(acct), 'utf8')).channelTitle };
  } catch {
    return null;
  }
}
const saveAccount = (acct: string, a: Account) => {
  fs.mkdirSync(YT_DIR, { recursive: true });
  fs.writeFileSync(acctPath(acct), JSON.stringify({ channelTitle: a.channelTitle, refreshToken: encrypt(a.refreshToken) }), { mode: 0o600 });
};
export const disconnectAccount = (acct: string) => fs.rmSync(acctPath(acct), { force: true });

const googleForm = async (p: string, body: Record<string, string>) => {
  const res = await fetch(`${OAUTH_BASE}${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, any> };
};

type Pending = { deviceCode: string; intervalMs: number; expiresAt: number; nextPollAt: number };
const pendingConnects = once('ytPendingConnects', () => new Map<string, Pending>());

export async function startConnect() {
  const { ok, data } = await googleForm('/device/code', { client_id: process.env.YOUTUBE_CLIENT_ID!, scope: SCOPE });
  if (!ok) throw new Error(String(data.error_description || data.error || 'Google rejected the request'));
  const acct = crypto.randomBytes(16).toString('hex');
  const intervalMs = Number(data.interval ?? 5) * 1000;
  pendingConnects.set(acct, {
    deviceCode: String(data.device_code), intervalMs, nextPollAt: 0,
    expiresAt: Date.now() + Number(data.expires_in ?? 1800) * 1000,
  });
  return {
    acct,
    userCode: String(data.user_code),
    verificationUrl: String(data.verification_url ?? data.verification_uri ?? 'https://www.google.com/device'),
    interval: intervalMs / 1000,
  };
}

export async function pollConnect(acct: string): Promise<{ status: string; channelTitle?: string; error?: string }> {
  const p = pendingConnects.get(acct);
  if (!p) return getAccount(acct) ? { status: 'connected', ...getAccount(acct)! } : { status: 'none' };
  if (Date.now() > p.expiresAt) { pendingConnects.delete(acct); return { status: 'expired' }; }
  // Keep to Google's polling interval however often the phone asks
  if (Date.now() < p.nextPollAt) return { status: 'pending' };
  p.nextPollAt = Date.now() + p.intervalMs;
  const { ok, data } = await googleForm('/token', {
    client_id: process.env.YOUTUBE_CLIENT_ID!,
    client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
    device_code: p.deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  if (!ok) {
    if (data.error === 'authorization_pending') return { status: 'pending' };
    if (data.error === 'slow_down') { p.intervalMs += 5000; return { status: 'pending' }; }
    pendingConnects.delete(acct);
    if (data.error === 'access_denied') return { status: 'denied' };
    if (data.error === 'expired_token') return { status: 'expired' };
    return { status: 'error', error: String(data.error_description || data.error || 'Sign-in failed') };
  }
  pendingConnects.delete(acct);
  if (!data.refresh_token) return { status: 'error', error: 'Google did not return a refresh token. Remove the app from your Google account and try again.' };
  const ch = await fetch(`${API_BASE}/youtube/v3/channels?part=snippet&mine=true`, { headers: { Authorization: `Bearer ${data.access_token}` } });
  const item = ((await ch.json().catch(() => ({}))) as any).items?.[0];
  if (!ch.ok || !item) return { status: 'error', error: 'This Google account has no YouTube channel. Create one at youtube.com first.' };
  saveAccount(acct, { channelTitle: item.snippet.title, refreshToken: String(data.refresh_token) });
  return { status: 'connected', channelTitle: item.snippet.title };
}

async function accessToken(acct: string) {
  let stored: Account;
  try {
    stored = JSON.parse(fs.readFileSync(acctPath(acct), 'utf8'));
  } catch {
    throw new Error('Connect a YouTube channel first');
  }
  const { ok, data } = await googleForm('/token', {
    client_id: process.env.YOUTUBE_CLIENT_ID!,
    client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
    refresh_token: decrypt(stored.refreshToken),
    grant_type: 'refresh_token',
  });
  if (!ok) {
    if (data.error === 'invalid_grant') {
      disconnectAccount(acct);
      throw new Error('YouTube access was removed or expired. Connect your channel again.');
    }
    throw new Error(String(data.error_description || data.error || 'Could not get YouTube access'));
  }
  return String(data.access_token);
}

const uploading = once('ytUploading', () => new Set<string>());

// Resumable upload in the background; progress and the video id are written to the recording
export function startYouTubeUpload(r: Recording, acct: string, privacy: Privacy) {
  if (uploading.has(r.id)) return;
  uploading.add(r.id);
  patch(r.code, r.id, x => { x.status = 'uploading'; x.ytAcct = acct; x.privacy = privacy; x.youtube = { progress: 0, videoId: null, error: null }; });
  uploadToYouTube(r, acct, privacy)
    .catch(e => {
      console.error('[recordings] YouTube upload failed', e);
      patch(r.code, r.id, x => { x.status = 'failed'; x.youtube.error = String(e?.message || e).slice(0, 300); });
    })
    .finally(() => uploading.delete(r.id));
}

async function uploadToYouTube(r: Recording, acct: string, privacy: Privacy) {
  const file = filePath(r);
  const size = fs.statSync(file).size;
  if (!size) throw new Error('The recording is empty');
  const token = await accessToken(acct);
  const init = await fetch(`${API_BASE}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(size),
      'X-Upload-Content-Type': `video/${r.ext}`,
    },
    body: JSON.stringify({
      snippet: { title: r.title.slice(0, 100), description: `Recorded live with CricScore · Match ${r.code}`, categoryId: '17' },
      status: { privacyStatus: privacy, selfDeclaredMadeForKids: false },
    }),
  });
  const location = init.headers.get('location');
  if (!init.ok || !location) throw new Error(await googleError(init, 'YouTube refused the upload'));

  let sent = 0, lastPct = 0;
  const progress = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      sent += chunk.length;
      const pct = Math.min(99, Math.floor((sent / size) * 100));
      if (pct >= lastPct + 2) {
        lastPct = pct;
        try { patch(r.code, r.id, x => { x.youtube.progress = pct; }); } catch {}
      }
      cb(null, chunk);
    },
  });
  const put = await fetch(location, {
    method: 'PUT',
    headers: { 'Content-Type': `video/${r.ext}`, 'Content-Length': String(size) },
    body: Readable.toWeb(fs.createReadStream(file).pipe(progress)) as ReadableStream,
    duplex: 'half',
  } as RequestInit);
  if (!put.ok) throw new Error(await googleError(put, 'Upload to YouTube failed'));
  const video = (await put.json()) as { id?: string };
  if (!video.id) throw new Error('YouTube did not return a video id');
  patch(r.code, r.id, x => { x.status = 'uploaded'; x.youtube = { progress: 100, videoId: video.id!, error: null }; });
}

async function googleError(res: Response, fallback: string) {
  const data = (await res.json().catch(() => ({}))) as any;
  const reason = data.error?.errors?.[0]?.reason;
  if (reason === 'quotaExceeded') return 'YouTube daily upload quota is used up. Try again tomorrow.';
  if (reason === 'uploadLimitExceeded') return 'This channel has hit its YouTube upload limit for today.';
  return data.error?.message || `${fallback} (HTTP ${res.status})`;
}
