import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { execute, queryOne, queryRows } from './db';

export type RecordingStatus = 'RECORDING' | 'READY' | 'UPLOADING' | 'UPLOADED' | 'FAILED';

export interface RecordingRow {
  id: number;
  live_room_id: number;
  segment: number;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  chunks_received: number;
  status: RecordingStatus;
  youtube_video_id: string | null;
  upload_progress: number;
  upload_error: string | null;
  created_at: Date;
}

// Recorder MIME types the server accepts, mapped to the file extension used on disk
export const ACCEPTED_TYPES: Record<string, string> = {
  'video/webm': 'webm',
  'video/mp4': 'mp4',
};

export const MAX_CHUNK_BYTES = 25 * 1024 * 1024;

export function recordingsDir(): string {
  const dir = path.resolve(process.env.RECORDINGS_DIR || path.join(process.cwd(), 'recordings'));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export const recordingPath = (r: Pick<RecordingRow, 'file_name'>) => path.join(recordingsDir(), r.file_name);

export async function createRecording(liveRoomId: number, roomId: string, mimeType: string): Promise<RecordingRow> {
  const base = mimeType.split(';')[0].trim();
  const ext = ACCEPTED_TYPES[base];
  if (!ext) throw new Error('Unsupported recording format');
  // Segment numbers are allocated by the unique key; retry if two requests race
  for (let attempt = 0; attempt < 3; attempt++) {
    const next = await queryOne<{ n: number }>(
      'SELECT COALESCE(MAX(segment), 0) + 1 AS n FROM recordings WHERE live_room_id = ?',
      [liveRoomId],
    );
    const segment = next?.n ?? 1;
    try {
      const result = await execute(
        'INSERT INTO recordings (live_room_id, segment, file_name, mime_type) VALUES (?, ?, ?, ?)',
        [liveRoomId, segment, `${roomId}-part${segment}-${Date.now()}.${ext}`, base],
      );
      return (await getRecording(result.insertId))!;
    } catch (err) {
      if ((err as { code?: string }).code !== 'ER_DUP_ENTRY') throw err;
    }
  }
  throw new Error('Could not allocate a recording segment');
}

export function getRecording(id: number) {
  return queryOne<RecordingRow>('SELECT * FROM recordings WHERE id = ? LIMIT 1', [id]);
}

// Recording plus the room it belongs to, for authorization checks
export function getRecordingWithRoom(id: number) {
  return queryOne<
    RecordingRow & { room_id: string; room_status: string; broadcaster_id: number; title: string; description: string | null }
  >(
    `SELECT rec.*, r.room_id, r.status AS room_status, r.broadcaster_id, r.title, r.description
     FROM recordings rec JOIN live_rooms r ON r.id = rec.live_room_id WHERE rec.id = ? LIMIT 1`,
    [id],
  );
}

export function listRecordings(liveRoomId: number) {
  return queryRows<RecordingRow>('SELECT * FROM recordings WHERE live_room_id = ? ORDER BY segment', [liveRoomId]);
}

export async function recordChunk(id: number, bytes: number): Promise<void> {
  await execute(
    'UPDATE recordings SET chunks_received = chunks_received + 1, size_bytes = size_bytes + ? WHERE id = ?',
    [bytes, id],
  );
}

export async function markRecordingReady(id: number): Promise<void> {
  await execute("UPDATE recordings SET status = 'READY' WHERE id = ? AND status = 'RECORDING'", [id]);
}

// Late chunks from a phone that was offline: back to RECORDING so nothing uploads a half file
export async function reopenRecording(id: number): Promise<void> {
  await execute("UPDATE recordings SET status = 'RECORDING', upload_error = NULL WHERE id = ? AND status IN ('READY', 'FAILED')", [id]);
}

export async function markRoomRecordingsReady(liveRoomId: number): Promise<void> {
  await execute("UPDATE recordings SET status = 'READY' WHERE live_room_id = ? AND status = 'RECORDING'", [liveRoomId]);
}

export async function setUploadState(
  id: number,
  fields: Partial<Pick<RecordingRow, 'status' | 'upload_progress' | 'upload_error' | 'youtube_video_id'>>,
): Promise<void> {
  const keys = Object.keys(fields) as (keyof typeof fields)[];
  if (!keys.length) return;
  await execute(
    `UPDATE recordings SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
    [...keys.map((k) => fields[k] ?? null), id],
  );
}

// Uploads run inside this process; any still marked UPLOADING after a restart were cut off
export async function failInterruptedUploads(): Promise<void> {
  await execute(
    "UPDATE recordings SET status = 'FAILED', upload_error = 'Upload interrupted by a server restart. Try again.' WHERE status = 'UPLOADING'",
  );
}

export function toClientRecording(r: RecordingRow) {
  return {
    id: r.id,
    segment: r.segment,
    mimeType: r.mime_type,
    sizeBytes: Number(r.size_bytes),
    status: r.status,
    youtubeVideoId: r.youtube_video_id,
    uploadProgress: r.upload_progress,
    uploadError: r.upload_error,
    createdAt: r.created_at,
  };
}
export type ClientRecording = ReturnType<typeof toClientRecording>;
