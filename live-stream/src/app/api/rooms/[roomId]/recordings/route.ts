import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isSameOrigin, jsonError } from '@/lib/http';
import { createRecording, listRecordings, toClientRecording } from '@/lib/recordings';
import { requireRoomControl } from '@/lib/room-access';
import { getYouTubeAccount, isYouTubeConfigured } from '@/lib/youtube';

export const dynamic = 'force-dynamic';
type Ctx = { params: Promise<{ roomId: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const access = await requireRoomControl((await params).roomId);
  if ('error' in access) return access.error;
  const [recordings, account] = await Promise.all([
    listRecordings(access.room.id),
    getYouTubeAccount(access.session.userId),
  ]);
  return NextResponse.json({
    recordings: recordings.map(toClientRecording),
    youtube: { configured: isYouTubeConfigured(), channelTitle: account?.channel_title ?? null },
  });
}

// late: a recording kept on the phone because there was no internet, uploaded after the match
const createSchema = z.object({ mimeType: z.string().max(100), late: z.boolean().optional() });

// Starts a new recording segment
export async function POST(req: Request, { params }: Ctx) {
  if (!isSameOrigin(req)) return jsonError('Forbidden', 403);
  const access = await requireRoomControl((await params).roomId);
  if ('error' in access) return access.error;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError('Invalid recording format', 400);
  if (access.room.status === 'ENDED' && !parsed.data.late) return jsonError('This stream has ended', 409);
  try {
    const rec = await createRecording(access.room.id, access.room.room_id, parsed.data.mimeType);
    return NextResponse.json({ recording: toClientRecording(rec) }, { status: 201 });
  } catch (err) {
    return jsonError((err as Error).message, 400);
  }
}
