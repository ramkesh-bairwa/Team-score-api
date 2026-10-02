import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/http';
import { fetchMatchScore } from '@/lib/match-result';
import { requireRoomControl } from '@/lib/room-access';

export const dynamic = 'force-dynamic';

// Live score for the studio's scoreboard overlay, fetched from the CricScore API for linked rooms
export async function GET(_req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const access = await requireRoomControl((await params).roomId);
  if ('error' in access) return access.error;
  const ref = access.room.external_ref;
  if (!ref) return NextResponse.json({ score: null });
  try {
    return NextResponse.json({ score: await fetchMatchScore(ref) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return jsonError('Score feed unavailable', 502);
  }
}
