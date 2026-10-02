import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { jsonError } from '@/lib/http';
import { getRecordingWithRoom, recordingPath } from '@/lib/recordings';
import { getRoom } from '@/lib/rooms';

// Public playback of a finished CricScore match (the stream itself was public). Supports Range
// requests so the player can seek through a long match. Other rooms' recordings stay owner-only.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const rec = Number.isInteger(id) && id > 0 ? await getRecordingWithRoom(id) : null;
  const room = rec ? await getRoom(rec.room_id) : null;
  if (!rec || !room?.external_ref || room.status !== 'ENDED' || rec.status === 'RECORDING') {
    return jsonError('Video not found', 404);
  }

  const file = recordingPath(rec);
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return jsonError('Video file is missing', 404);
  }
  const headers: Record<string, string> = {
    'Content-Type': rec.mime_type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
  };

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(end, size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: { ...headers, 'Content-Length': String(size) },
  });
}
