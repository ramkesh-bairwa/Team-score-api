import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/http';
import { getMatchResult } from '@/lib/match-result';
import { getRoom } from '@/lib/rooms';
import { roomIdSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

// Public: the final result of the match this room streamed (null until the match is over)
export async function GET(_req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const parsed = roomIdSchema.safeParse((await params).roomId);
  const room = parsed.success ? await getRoom(parsed.data) : null;
  if (!room?.external_ref) return jsonError('Not found', 404);
  return NextResponse.json({ result: await getMatchResult(room.external_ref) }, { headers: { 'Cache-Control': 'no-store' } });
}
