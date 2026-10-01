import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream, statSync } from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { execute, queryOne } from './db';
import { getRecordingWithRoom, recordingPath, setUploadState } from './recordings';

// YouTube uploads use Google's OAuth device flow ("TVs and Limited Input devices" client):
// the user enters a short code at google.com/device from any phone or computer. No redirect URI
// is needed, which matters because the public address (tunnel URL) changes between runs.

const OAUTH_BASE = process.env.GOOGLE_OAUTH_BASE || 'https://oauth2.googleapis.com';
const API_BASE = process.env.YOUTUBE_API_BASE || 'https://www.googleapis.com';
// The device flow doesn't allow youtube.upload; the broader youtube scope covers videos.insert
const SCOPE = 'https://www.googleapis.com/auth/youtube';

export const isYouTubeConfigured = () => !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET);

// ── Refresh-token encryption at rest ───────────────────────
const key = () => createHash('sha256').update(`youtube-token:${process.env.SESSION_SECRET}`).digest();

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join('.');
}

function decrypt(enc: string): string {
  const [iv, tag, data] = enc.split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

// ── Accounts ───────────────────────────────────────────────
interface AccountRow {
  user_id: number;
  channel_id: string;
  channel_title: string;
  refresh_token_enc: string;
}

export function getYouTubeAccount(userId: number) {
  return queryOne<AccountRow>(
    'SELECT user_id, channel_id, channel_title, refresh_token_enc FROM youtube_accounts WHERE user_id = ? LIMIT 1',
    [userId],
  );
}

export async function disconnectYouTube(userId: number): Promise<void> {
  await execute('DELETE FROM youtube_accounts WHERE user_id = ?', [userId]);
}

async function googleForm(path: string, body: Record<string, string>) {
  const res = await fetch(`${OAUTH_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

// ── Device flow ────────────────────────────────────────────
interface PendingDevice {
  deviceCode: string;
  intervalMs: number;
  expiresAt: number;
  nextPollAt: number;
}
const pending = new Map<number, PendingDevice>(); // userId → device code in progress

export async function startDeviceFlow(userId: number) {
  const { ok, data } = await googleForm('/device/code', { client_id: process.env.YOUTUBE_CLIENT_ID!, scope: SCOPE });
  if (!ok) throw new Error(String(data.error_description || data.error || 'Google rejected the request'));
  const intervalMs = Number(data.interval ?? 5) * 1000;
  pending.set(userId, {
    deviceCode: String(data.device_code),
    intervalMs,
    expiresAt: Date.now() + Number(data.expires_in ?? 1800) * 1000,
    nextPollAt: 0,
  });
  return {
    userCode: String(data.user_code),
    verificationUrl: String(data.verification_url ?? data.verification_uri ?? 'https://www.google.com/device'),
    expiresIn: Number(data.expires_in ?? 1800),
    interval: intervalMs / 1000,
  };
}

export type PollResult =
  | { status: 'pending' }
  | { status: 'connected'; channelTitle: string }
  | { status: 'denied' | 'expired' | 'none' }
  | { status: 'error'; error: string };

export async function pollDeviceFlow(userId: number): Promise<PollResult> {
  const p = pending.get(userId);
  if (!p) return { status: 'none' };
  if (Date.now() > p.expiresAt) {
    pending.delete(userId);
    return { status: 'expired' };
  }
  // Respect Google's polling interval no matter how often the browser asks
  if (Date.now() < p.nextPollAt) return { status: 'pending' };
  p.nextPollAt = Date.now() + p.intervalMs;

  const { ok, data } = await googleForm('/token', {
    client_id: process.env.YOUTUBE_CLIENT_ID!,
    client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
    device_code: p.deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  if (!ok) {
    switch (data.error) {
      case 'authorization_pending':
        return { status: 'pending' };
      case 'slow_down':
        p.intervalMs += 5000;
        return { status: 'pending' };
      case 'access_denied':
        pending.delete(userId);
        return { status: 'denied' };
      case 'expired_token':
        pending.delete(userId);
        return { status: 'expired' };
      default:
        pending.delete(userId);
        return { status: 'error', error: String(data.error_description || data.error || 'Sign-in failed') };
    }
  }

  pending.delete(userId);
  const accessToken = String(data.access_token);
  const refreshToken = data.refresh_token ? String(data.refresh_token) : null;
  if (!refreshToken) return { status: 'error', error: 'Google did not return a refresh token. Remove the app from your Google account and try again.' };

  const channel = await fetchChannel(accessToken);
  await execute(
    `INSERT INTO youtube_accounts (user_id, channel_id, channel_title, refresh_token_enc) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE channel_id = VALUES(channel_id), channel_title = VALUES(channel_title),
       refresh_token_enc = VALUES(refresh_token_enc)`,
    [userId, channel.id, channel.title, encrypt(refreshToken)],
  );
  return { status: 'connected', channelTitle: channel.title };
}

async function fetchChannel(accessToken: string): Promise<{ id: string; title: string }> {
  const res = await fetch(`${API_BASE}/youtube/v3/channels?part=snippet&mine=true`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json().catch(() => ({}))) as { items?: { id: string; snippet: { title: string } }[] };
  const item = data.items?.[0];
  if (!res.ok || !item) throw new Error('This Google account has no YouTube channel. Create one at youtube.com first.');
  return { id: item.id, title: item.snippet.title };
}

async function getAccessToken(account: AccountRow): Promise<string> {
  const { ok, data } = await googleForm('/token', {
    client_id: process.env.YOUTUBE_CLIENT_ID!,
    client_secret: process.env.YOUTUBE_CLIENT_SECRET!,
    refresh_token: decrypt(account.refresh_token_enc),
    grant_type: 'refresh_token',
  });
  if (!ok) {
    if (data.error === 'invalid_grant') await disconnectYouTube(account.user_id);
    throw new Error(
      data.error === 'invalid_grant'
        ? 'YouTube access was revoked or expired. Connect your channel again.'
        : String(data.error_description || data.error || 'Could not refresh YouTube access'),
    );
  }
  return String(data.access_token);
}

// ── Upload ─────────────────────────────────────────────────
export type Privacy = 'private' | 'unlisted' | 'public';
const running = new Set<number>();

// Starts a resumable upload in the background; progress and result are written to the recordings row
export function startUpload(recordingId: number, userId: number, opts: { title: string; description: string; privacy: Privacy }) {
  if (running.has(recordingId)) return;
  running.add(recordingId);
  uploadRecording(recordingId, userId, opts)
    .catch(async (err) => {
      console.error('[youtube] upload failed', err);
      await setUploadState(recordingId, { status: 'FAILED', upload_error: String(err.message || err).slice(0, 500) });
    })
    .finally(() => running.delete(recordingId));
}

async function uploadRecording(recordingId: number, userId: number, opts: { title: string; description: string; privacy: Privacy }) {
  const rec = await getRecordingWithRoom(recordingId);
  if (!rec) throw new Error('Recording not found');
  const account = await getYouTubeAccount(userId);
  if (!account) throw new Error('Connect a YouTube channel first');
  const file = recordingPath(rec);
  const size = statSync(file).size;
  if (!size) throw new Error('The recording is empty');

  await setUploadState(recordingId, { status: 'UPLOADING', upload_progress: 0, upload_error: null });
  const accessToken = await getAccessToken(account);

  // 1. Create the upload session
  const init = await fetch(`${API_BASE}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(size),
      'X-Upload-Content-Type': rec.mime_type,
    },
    body: JSON.stringify({
      snippet: { title: opts.title.slice(0, 100), description: opts.description.slice(0, 5000), categoryId: '17' },
      status: { privacyStatus: opts.privacy, selfDeclaredMadeForKids: false },
    }),
  });
  const location = init.headers.get('location');
  if (!init.ok || !location) throw new Error(await googleError(init, 'YouTube refused the upload'));

  // 2. Stream the file, recording progress as bytes go out
  let sent = 0;
  let lastPct = 0;
  const progress = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      sent += chunk.length;
      const pct = Math.min(99, Math.floor((sent / size) * 100));
      if (pct >= lastPct + 2) {
        lastPct = pct;
        setUploadState(recordingId, { upload_progress: pct }).catch(() => {});
      }
      cb(null, chunk);
    },
  });
  const body = Readable.toWeb(createReadStream(file).pipe(progress)) as ReadableStream;
  const put = await fetch(location, {
    method: 'PUT',
    headers: { 'Content-Type': rec.mime_type, 'Content-Length': String(size) },
    body,
    duplex: 'half',
  } as RequestInit);
  if (!put.ok) throw new Error(await googleError(put, 'Upload to YouTube failed'));
  const video = (await put.json()) as { id?: string };
  if (!video.id) throw new Error('YouTube did not return a video ID');

  await setUploadState(recordingId, { status: 'UPLOADED', upload_progress: 100, youtube_video_id: video.id });
}

async function googleError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string; errors?: { reason?: string }[] } };
  const reason = data.error?.errors?.[0]?.reason;
  if (reason === 'quotaExceeded') return 'YouTube API daily quota exceeded. Try again tomorrow.';
  if (reason === 'uploadLimitExceeded') return 'This channel has hit its YouTube upload limit for today.';
  return data.error?.message || `${fallback} (HTTP ${res.status})`;
}
