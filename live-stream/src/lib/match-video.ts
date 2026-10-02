import { spawn } from 'node:child_process';
import { statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execute, queryOne, queryRows } from './db';
import { getRecording, listRecordings, markRoomRecordingsReady, recordingPath, recordingsDir, type RecordingRow } from './recordings';
import { getRoom } from './rooms';
import { getYouTubeAccount, isYouTubeConfigured, startUpload, type Privacy } from './youtube';

// When a CricScore match stream ends, its recorded segments (one per reconnect) are joined into a
// single seekable MP4: the "full match" video. It is stored as segment 0 of the room's recordings,
// so the existing download and YouTube upload code works on it unchanged. Needs ffmpeg; without it
// the parts are still kept and the watch page plays them back to back.

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
export const FULL_SEGMENT = 0;
const running = new Set<number>();

let ffmpegOk: Promise<boolean> | null = null;
export function hasFfmpeg(): Promise<boolean> {
  ffmpegOk ??= new Promise((resolve) => {
    const p = spawn(FFMPEG, ['-version'], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('exit', (code) => resolve(code === 0));
  });
  return ffmpegOk;
}

export function getFullRecording(liveRoomId: number) {
  return queryOne<RecordingRow>('SELECT * FROM recordings WHERE live_room_id = ? AND segment = ? LIMIT 1', [
    liveRoomId,
    FULL_SEGMENT,
  ]);
}

// Fire-and-forget from the socket server when a room ends. Builds run one at a time: encoding is
// CPU-heavy and several matches can end together.
let queue: Promise<void> = Promise.resolve();
export function buildMatchVideo(roomId: string) {
  queue = queue.then(() => build(roomId)).catch((err) => console.error('[match-video] failed', roomId, err));
}

// A part arrived after the full video was built (a phone that had no internet during the match).
// Drop the old full video and build it again, unless it is already on its way to YouTube.
export function rebuildMatchVideo(roomId: string) {
  queue = queue
    .then(async () => {
      const room = await getRoom(roomId);
      if (!room?.external_ref) return;
      const parts = await listRecordings(room.id);
      // Another part is still coming in; its own /finish will trigger the rebuild
      if (parts.some((p) => p.segment !== FULL_SEGMENT && p.status === 'RECORDING')) return;
      const full = parts.find((p) => p.segment === FULL_SEGMENT);
      if (full) {
        if (full.status === 'UPLOADING' || full.status === 'UPLOADED') return;
        try {
          unlinkSync(recordingPath(full));
        } catch {}
        await execute('DELETE FROM recordings WHERE id = ?', [full.id]);
      }
      await build(roomId);
    })
    .catch((err) => console.error('[match-video] rebuild failed', roomId, err));
}

async function build(roomId: string) {
  const room = await getRoom(roomId);
  if (!room?.external_ref || running.has(room.id)) return;
  // Rooms ended after a server restart never went through the normal close-out
  await markRoomRecordingsReady(room.id);
  const parts = (await listRecordings(room.id)).filter((r) => r.segment !== FULL_SEGMENT && Number(r.size_bytes) > 0);
  if (!parts.length || (await getFullRecording(room.id)) || !(await hasFfmpeg())) return;

  running.add(room.id);
  const fileName = `${roomId}-full-${Date.now()}.mp4`;
  const out = path.join(recordingsDir(), fileName);
  // Status RECORDING = "being built"; READY once ffmpeg finishes
  const { insertId } = await execute(
    'INSERT INTO recordings (live_room_id, segment, file_name, mime_type) VALUES (?, ?, ?, ?)',
    [room.id, FULL_SEGMENT, fileName, 'video/mp4'],
  );
  const list = path.join(recordingsDir(), `${roomId}-concat.txt`);
  try {
    writeFileSync(list, parts.map((p) => `file '${recordingPath(p).replace(/'/g, "'\\''")}'`).join('\n'));
    // Re-encode: MediaRecorder WebM has no cues (not seekable) and parts can't be stream-copied
    // together reliably. H.264/AAC plays everywhere and is what YouTube prefers.
    await run([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'concat', '-safe', '0', '-fflags', '+genpts', '-i', list,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '30',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart',
      out,
    ]);
    await execute("UPDATE recordings SET status = 'READY', size_bytes = ?, chunks_received = ? WHERE id = ?", [
      statSync(out).size,
      parts.length,
      insertId,
    ]);
    console.log(`[match-video] ${roomId}: full match video ready (${parts.length} part(s))`);
  } catch (err) {
    // Drop the half-built video; the parts stay available and the watch page plays them instead
    await execute('DELETE FROM recordings WHERE id = ?', [insertId]);
    try {
      unlinkSync(out);
    } catch {}
    throw err;
  } finally {
    running.delete(room.id);
    try {
      unlinkSync(list);
    } catch {}
  }
  await autoUpload(insertId, room.broadcaster_id, room.title).catch((err) =>
    console.error('[match-video] YouTube auto-upload could not start', err),
  );
}

function run(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg exited with ${code}`))));
  });
}

// YOUTUBE_AUTO_UPLOAD = unlisted (default) | public | private | off
async function autoUpload(recordingId: number, userId: number, title: string) {
  const mode = (process.env.YOUTUBE_AUTO_UPLOAD || 'unlisted').toLowerCase();
  if (mode === 'off' || !isYouTubeConfigured() || !(await getYouTubeAccount(userId))) return;
  const privacy: Privacy = mode === 'public' || mode === 'private' ? mode : 'unlisted';
  const rec = await getRecording(recordingId);
  if (rec?.status !== 'READY') return;
  startUpload(recordingId, userId, {
    title: `${title} · Full match`.slice(0, 100),
    description: 'Full match recorded live with CricScore.',
    privacy,
  });
}

// After a restart: anything left half-built is thrown away and rebuilt; ended matches that never
// got a full video (e.g. the server stopped right after the match) are picked up too
export async function resumeMatchVideos() {
  const stale = await queryRows<RecordingRow & { room_id: string }>(
    `SELECT rec.*, r.room_id FROM recordings rec JOIN live_rooms r ON r.id = rec.live_room_id
     WHERE rec.segment = ? AND rec.status = 'RECORDING'`,
    [FULL_SEGMENT],
  );
  for (const s of stale) {
    try {
      unlinkSync(recordingPath(s));
    } catch {}
    await execute('DELETE FROM recordings WHERE id = ?', [s.id]);
  }
  const pending = await queryRows<{ room_id: string }>(
    `SELECT r.room_id FROM live_rooms r
     WHERE r.status = 'ENDED' AND r.external_ref IS NOT NULL AND r.ended_at > UTC_TIMESTAMP() - INTERVAL 2 DAY
       AND EXISTS (SELECT 1 FROM recordings p WHERE p.live_room_id = r.id AND p.segment > 0 AND p.size_bytes > 0)
       AND NOT EXISTS (SELECT 1 FROM recordings f WHERE f.live_room_id = r.id AND f.segment = ?)`,
    [FULL_SEGMENT],
  );
  for (const r of pending) buildMatchVideo(r.room_id);
}
