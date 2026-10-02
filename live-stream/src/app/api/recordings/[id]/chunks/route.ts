import { appendFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { isSameOrigin, jsonError } from '@/lib/http';
import { MAX_CHUNK_BYTES, getRecording, recordChunk, recordingPath } from '@/lib/recordings';
import { requireRecordingControl } from '@/lib/room-access';

// Appends one MediaRecorder chunk. Chunks must arrive in order (?seq=0,1,2…); a repeated seq
// (a retry after a lost response) is acknowledged without being written twice.
const locks = new Map<number, Promise<unknown>>();

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return jsonError('Forbidden', 403);
  const access = await requireRecordingControl((await params).id);
  if ('error' in access) return access.error;
  const { recording } = access;
  // Segment 0 is the full match video the server builds itself
  if (recording.status !== 'RECORDING' || recording.segment === 0) return jsonError('Recording is closed', 409);

  const seq = Number(new URL(req.url).searchParams.get('seq'));
  if (!Number.isInteger(seq) || seq < 0) return jsonError('Invalid seq', 400);
  const data = Buffer.from(await req.arrayBuffer());
  if (!data.length) return jsonError('Empty chunk', 400);
  if (data.length > MAX_CHUNK_BYTES) return jsonError('Chunk too large', 413);

  // Serialize writes per recording so the order check and append are atomic
  const prev = locks.get(recording.id) ?? Promise.resolve();
  const run = prev.then(async () => {
    const current = await getRecording(recording.id);
    if (!current) return { status: 404 as const };
    if (seq < current.chunks_received) return { status: 200 as const, duplicate: true, next: current.chunks_received };
    if (seq > current.chunks_received) return { status: 409 as const, next: current.chunks_received };
    await appendFile(recordingPath(current), data);
    await recordChunk(current.id, data.length);
    return { status: 200 as const, duplicate: false, next: seq + 1 };
  });
  locks.set(recording.id, run.catch(() => {}));
  const result = await run;
  if (result.status === 404) return jsonError('Recording not found', 404);
  if (result.status === 409) return NextResponse.json({ error: 'Out of order', next: result.next }, { status: 409 });
  return NextResponse.json({ ok: true, duplicate: result.duplicate, next: result.next });
}
