import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/http';
import { requireRoomControl } from '@/lib/room-access';

export const dynamic = 'force-dynamic';

// Live score for the studio's scoreboard overlay, fetched from the CricScore API for linked rooms
export async function GET(_req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const access = await requireRoomControl((await params).roomId);
  if ('error' in access) return access.error;
  const ref = access.room.external_ref;
  const base = process.env.CRICSCORE_API_URL?.replace(/\/+$/, '');
  if (!ref?.startsWith('cricscore:') || !base) return NextResponse.json({ score: null });

  try {
    const res = await fetch(`${base}/live/${encodeURIComponent(ref.slice('cricscore:'.length))}/overlay`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return NextResponse.json({ score: null });
    return NextResponse.json({ score: await res.json() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return jsonError('Score feed unavailable', 502);
  }
}
