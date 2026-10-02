import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/http';
import { hasFfmpeg } from '@/lib/match-video';
import { listRecordings } from '@/lib/recordings';
import { getRoom } from '@/lib/rooms';
import { withBase } from '@/lib/paths';
import { roomIdSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

// Public: what viewers can watch after a CricScore match stream has ended. The full match video
// once it's built; until then (or without ffmpeg) the recorded parts, played back to back.
export async function GET(_req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const parsed = roomIdSchema.safeParse((await params).roomId);
  const room = parsed.success ? await getRoom(parsed.data) : null;
  if (!room || !room.external_ref) return jsonError('Not found', 404);
  if (room.status !== 'ENDED') return NextResponse.json({ status: 'live' });

  const recs = await listRecordings(room.id);
  const url = (id: number) => withBase(`/api/recordings/${id}/watch`);
  const full = recs.find((r) => r.segment === 0);
  const parts = recs
    .filter((r) => r.segment > 0 && r.status !== 'RECORDING' && Number(r.size_bytes) > 0)
    .map((r) => ({ id: r.id, url: url(r.id) }));
  const fullReady = full && full.status !== 'RECORDING';
  const building = full?.status === 'RECORDING' || (!full && parts.length > 0 && (await hasFfmpeg()));

  return NextResponse.json({
    status: fullReady ? 'ready' : building ? 'processing' : parts.length ? 'parts' : 'none',
    full: fullReady ? { url: url(full.id), youtubeVideoId: full.youtube_video_id } : null,
    youtubeVideoId: recs.find((r) => r.youtube_video_id)?.youtube_video_id ?? null,
    parts,
  });
}
