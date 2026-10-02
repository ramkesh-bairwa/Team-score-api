import { NextResponse } from 'next/server';
import { z } from 'zod';
import { jsonError } from '@/lib/http';
import { isIntegrationRequest } from '@/lib/integration';
import { sendReplayCommand } from '@/lib/remote';
import { findOpenRoomByExternalRef } from '@/lib/rooms';
import { firstIssue } from '@/lib/validation';

const bodySchema = z.object({
  matchCode: z.string().trim().regex(/^[A-Z0-9]{4,12}$/, 'Invalid match code'),
  action: z.enum(['start', 'stop']),
  seconds: z.number().int().min(5).max(180).optional().default(30),
  rate: z.number().min(0.25).max(1).optional().default(1),
});

// Server-to-server: the scorer's phone (through the CricScore API) puts a replay on air on the
// match's camera device. Authenticated with INTEGRATION_SECRET.
export async function POST(req: Request) {
  if (!isIntegrationRequest(req)) return jsonError('Unauthorized', 401);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(firstIssue(parsed.error), 400);
  const { matchCode, action, seconds, rate } = parsed.data;

  const room = await findOpenRoomByExternalRef(`cricscore:${matchCode}`);
  const delivered =
    !!room && sendReplayCommand(room.room_id, action === 'stop' ? { action } : { action, seconds, rate });
  if (!delivered) return jsonError('The camera is not live right now. Tap "Go live" in the camera studio first.', 409);
  return NextResponse.json({ ok: true });
}
