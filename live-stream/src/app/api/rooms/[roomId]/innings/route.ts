import { NextResponse } from 'next/server';
import { z } from 'zod';
import { markInningsEnd } from '@/lib/highlights';
import { captureMatchResult } from '@/lib/match-result';
import { isSameOrigin, jsonError } from '@/lib/http';
import { requireRoomControl } from '@/lib/room-access';

const bodySchema = z.object({ innings: z.number().int().min(1).max(4), title: z.string().trim().min(1).max(200) });

// Camera device reports that an innings ended; the server then cuts that innings' video
export async function POST(req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  if (!isSameOrigin(req)) return jsonError('Forbidden', 403);
  const access = await requireRoomControl((await params).roomId);
  if ('error' in access) return access.error;
  if (!access.room.external_ref) return jsonError('Innings videos are only for CricScore matches', 400);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError('Invalid innings', 400);
  await markInningsEnd(access.room, parsed.data.innings, parsed.data.title);
  captureMatchResult(access.room.external_ref);
  return NextResponse.json({ ok: true });
}
