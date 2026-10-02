import { spawn } from 'node:child_process';
import { mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execute, queryOne, queryRows } from './db';
import { FULL_SEGMENT, hasFfmpeg } from './match-video';
import { listRecordings, recordingPath, recordingsDir } from './recordings';
import { getRoom, type RoomRow } from './rooms';
import { withBase } from './paths';

// Ball-by-ball replay clips and per-innings videos for CricScore match rooms.
// Ball clips come from the camera device's replay buffer (clean camera video, no scoreboard),
// so viewers can watch any ball again. Innings videos are cut from the stream recording.

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';
export const BALL_CLIP_S = 20;

type Status = 'PROCESSING' | 'READY' | 'FAILED';

export interface BallClipRow {
  id: number;
  live_room_id: number;
  innings: number;
  delivery: number;
  over_label: string;
  kind: string;
  label: string;
  caption: string | null;
  file_name: string | null;
  status: Status;
  size_bytes: number;
  created_at: Date;
}

export interface InningsVideoRow {
  id: number;
  live_room_id: number;
  innings: number;
  title: string;
  file_name: string | null;
  status: Status;
  size_bytes: number;
  ended_at: Date;
}

export interface BallMeta {
  innings: number;
  delivery: number;
  over: string;
  kind: string;
  label: string;
  caption: string;
  trimStart: number; // seconds to skip at the start of the joined clips
}

const tmpDir = () => {
  const d = path.join(recordingsDir(), 'tmp');
  mkdirSync(d, { recursive: true });
  return d;
};

// One encode at a time: these share the CPU with the full match build and the live server
let queue: Promise<unknown> = Promise.resolve();
const enqueue = <T>(job: () => Promise<T>) => {
  const run = queue.then(job, job);
  queue = run.catch(() => {});
  return run;
};

// ── Ball clips ─────────────────────────────────────────────────────

export async function saveBallClip(room: RoomRow, meta: BallMeta, parts: { data: Buffer; type: string }[]) {
  // Re-scoring a delivery after an undo replaces its clip
  const old = await queryOne<BallClipRow>(
    'SELECT * FROM ball_clips WHERE live_room_id = ? AND innings = ? AND delivery = ? LIMIT 1',
    [room.id, meta.innings, meta.delivery],
  );
  if (old?.file_name) rmSync(path.join(recordingsDir(), old.file_name), { force: true });
  await execute(
    `INSERT INTO ball_clips (live_room_id, innings, delivery, over_label, kind, label, caption, status, file_name, size_bytes)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PROCESSING', NULL, 0)
     ON DUPLICATE KEY UPDATE over_label = VALUES(over_label), kind = VALUES(kind), label = VALUES(label),
       caption = VALUES(caption), status = 'PROCESSING', file_name = NULL, size_bytes = 0`,
    [room.id, meta.innings, meta.delivery, meta.over, meta.kind, meta.label, meta.caption || null],
  );
  const row = await queryOne<BallClipRow>(
    'SELECT * FROM ball_clips WHERE live_room_id = ? AND innings = ? AND delivery = ? LIMIT 1',
    [room.id, meta.innings, meta.delivery],
  );
  const id = row!.id;
  const stamp = Date.now();
  const ext = (t: string) => (t.includes('mp4') ? 'mp4' : 'webm');
  const files = parts.map((p, i) => {
    const f = path.join(tmpDir(), `ball-${id}-${stamp}-${i}.${ext(p.type)}`);
    writeFileSync(f, p.data);
    return f;
  });

  void enqueue(async () => {
    try {
      let fileName: string;
      if (await hasFfmpeg()) {
        fileName = `${room.room_id}-ball-${meta.innings}-${meta.delivery}-${stamp}.mp4`;
        const out = path.join(recordingsDir(), fileName);
        await ffmpeg([
          ...files.flatMap((f) => ['-i', f]),
          // Pieces can differ in size (front/back camera), so each is fitted to 720p first
          '-filter_complex',
          files
            .map((_, i) => `[${i}:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[p${i}]`)
            .join(';') +
            `;${files.map((_, i) => `[p${i}]`).join('')}concat=n=${files.length}:v=1:a=0,` +
            `trim=start=${Math.max(0, meta.trimStart).toFixed(2)},setpts=PTS-STARTPTS[v]`,
          '-map', '[v]', '-an',
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-pix_fmt', 'yuv420p', '-r', '30',
          '-movflags', '+faststart',
          out,
        ]);
      } else {
        // No ffmpeg: keep the newest piece as it is (each piece plays on its own)
        fileName = `${room.room_id}-ball-${meta.innings}-${meta.delivery}-${stamp}.${path.extname(files[files.length - 1]).slice(1)}`;
        renameSync(files[files.length - 1], path.join(recordingsDir(), fileName));
      }
      const size = statSync(path.join(recordingsDir(), fileName)).size;
      await execute("UPDATE ball_clips SET status = 'READY', file_name = ?, size_bytes = ? WHERE id = ? AND file_name IS NULL", [
        fileName,
        size,
        id,
      ]);
    } catch (err) {
      console.error('[highlights] ball clip failed', id, err);
      await execute("UPDATE ball_clips SET status = 'FAILED' WHERE id = ? AND file_name IS NULL", [id]);
    } finally {
      files.forEach((f) => rmSync(f, { force: true }));
    }
  });
  return id;
}

// ── Innings videos ─────────────────────────────────────────────────

// Called by the camera device when it sees an innings end (repeats are ignored)
export async function markInningsEnd(room: RoomRow, innings: number, title: string) {
  const res = await execute('INSERT IGNORE INTO innings_videos (live_room_id, innings, title) VALUES (?, ?, ?)', [
    room.id,
    innings,
    title.slice(0, 200),
  ]);
  // Give the last recording chunks (uploaded every few seconds) time to arrive
  if (res.affectedRows) setTimeout(() => void enqueue(() => buildInnings(room.room_id, innings)), 20_000);
}

async function buildInnings(roomId: string, innings: number) {
  const room = await getRoom(roomId);
  if (!room) return;
  const row = await queryOne<InningsVideoRow>('SELECT * FROM innings_videos WHERE live_room_id = ? AND innings = ?', [
    room.id,
    innings,
  ]);
  if (!row || row.status === 'READY') return;
  const prev =
    innings > 1
      ? await queryOne<InningsVideoRow>('SELECT * FROM innings_videos WHERE live_room_id = ? AND innings = ?', [
          room.id,
          innings - 1,
        ])
      : null;
  const from = prev ? prev.ended_at.getTime() : 0;
  const to = row.ended_at.getTime();

  // Recording parts overlapping the innings. A part runs from its creation to its last chunk.
  const parts = (await listRecordings(room.id))
    .filter((r) => r.segment !== FULL_SEGMENT && Number(r.size_bytes) > 0)
    .map((r) => {
      const start = r.created_at.getTime();
      const end = (r as unknown as { updated_at: Date }).updated_at.getTime() + 4000;
      return { file: recordingPath(r), start, end };
    })
    .filter((p) => p.end > from && p.start < to);

  try {
    if (!parts.length || !(await hasFfmpeg())) throw new Error(parts.length ? 'ffmpeg is not installed' : 'Nothing was recorded');
    const withAudio = (await Promise.all(parts.map((p) => hasAudio(p.file)))).every(Boolean);
    const filters = parts.map((p, i) => {
      const s = Math.max(0, (from - p.start) / 1000).toFixed(2);
      const e = ((Math.min(p.end, to) - p.start) / 1000).toFixed(2);
      const v = `[${i}:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS[v${i}]`;
      const a = withAudio ? `;[${i}:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${i}]` : '';
      return v + a;
    });
    const inputs = parts.map((_, i) => (withAudio ? `[v${i}][a${i}]` : `[v${i}]`)).join('');
    const fileName = `${roomId}-innings${innings}-${Date.now()}.mp4`;
    const out = path.join(recordingsDir(), fileName);
    await ffmpeg([
      ...parts.flatMap((p) => ['-i', p.file]),
      '-filter_complex',
      `${filters.join(';')};${inputs}concat=n=${parts.length}:v=1:a=${withAudio ? 1 : 0}[v]${withAudio ? '[a]' : ''}`,
      '-map', '[v]',
      ...(withAudio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '128k'] : ['-an']),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-r', '30',
      '-movflags', '+faststart',
      out,
    ]);
    await execute("UPDATE innings_videos SET status = 'READY', file_name = ?, size_bytes = ? WHERE id = ?", [
      fileName,
      statSync(out).size,
      row.id,
    ]);
    console.log(`[highlights] ${roomId}: innings ${innings} video ready`);
  } catch (err) {
    console.error('[highlights] innings video failed', roomId, innings, err);
    await execute("UPDATE innings_videos SET status = 'FAILED' WHERE id = ?", [row.id]);
  }
}

function hasAudio(file: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(FFPROBE, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => resolve(false));
    p.on('exit', () => resolve(out.trim().length > 0));
  });
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `ffmpeg exited with ${code}`))));
  });
}

// ── Listing ────────────────────────────────────────────────────────

export async function listHighlights(liveRoomId: number) {
  const [balls, innings] = await Promise.all([
    queryRows<BallClipRow>('SELECT * FROM ball_clips WHERE live_room_id = ? ORDER BY innings DESC, delivery DESC', [liveRoomId]),
    queryRows<InningsVideoRow>('SELECT * FROM innings_videos WHERE live_room_id = ? ORDER BY innings', [liveRoomId]),
  ]);
  return {
    balls: balls
      .filter((b) => b.status !== 'FAILED')
      .map((b) => ({
        id: b.id,
        innings: b.innings,
        delivery: b.delivery,
        over: b.over_label,
        kind: b.kind,
        label: b.label,
        caption: b.caption,
        ready: b.status === 'READY',
        url: b.status === 'READY' ? withBase(`/api/clips/ball/${b.id}`) : null,
      })),
    innings: innings.map((v) => ({
      id: v.id,
      innings: v.innings,
      title: v.title,
      status: v.status,
      url: v.status === 'READY' ? withBase(`/api/clips/innings/${v.id}`) : null,
    })),
  };
}
export type Highlights = Awaited<ReturnType<typeof listHighlights>>;

// Public file lookup for /api/clips/<kind>/<id> (CricScore match rooms only)
export async function getClipFile(kind: string, id: number) {
  const table = kind === 'ball' ? 'ball_clips' : kind === 'innings' ? 'innings_videos' : null;
  if (!table) return null;
  const row = await queryOne<{ file_name: string | null; status: Status; external_ref: string | null }>(
    `SELECT c.file_name, c.status, r.external_ref FROM ${table} c JOIN live_rooms r ON r.id = c.live_room_id WHERE c.id = ? LIMIT 1`,
    [id],
  );
  if (!row?.file_name || row.status !== 'READY' || !row.external_ref) return null;
  return { file: path.join(recordingsDir(), row.file_name), mime: row.file_name.endsWith('.mp4') ? 'video/mp4' : 'video/webm' };
}

// After a restart: rebuild innings videos that were cut off, and fail ball clips whose
// uploaded pieces (kept only in memory-scheduled jobs) are gone
export async function resumeHighlights() {
  await execute("UPDATE ball_clips SET status = 'FAILED' WHERE status = 'PROCESSING'");
  const pending = await queryRows<{ room_id: string; innings: number }>(
    `SELECT r.room_id, v.innings FROM innings_videos v JOIN live_rooms r ON r.id = v.live_room_id
     WHERE v.status = 'PROCESSING' ORDER BY v.innings`,
  );
  for (const p of pending) void enqueue(() => buildInnings(p.room_id, p.innings));
  rmSync(tmpDir(), { recursive: true, force: true });
}
