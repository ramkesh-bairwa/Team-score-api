import { NextResponse } from 'next/server';
import { listHighlights } from '@/lib/highlights';
import { jsonError } from '@/lib/http';
import { getRoom } from '@/lib/rooms';
import { roomIdSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

// Public: ball-by-ball replays and innings videos of a CricScore match (during and after it)
export async function GET(_req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const parsed = roomIdSchema.safeParse((await params).roomId);
  const room = parsed.success ? await getRoom(parsed.data) : null;
  if (!room?.external_ref) return jsonError('Not found', 404);
  return NextResponse.json(await listHighlights(room.id), { headers: { 'Cache-Control': 'no-store' } });
}
