import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createHostToken } from '@/lib/auth';
import { jsonError } from '@/lib/http';
import { getIntegrationUser, isIntegrationRequest } from '@/lib/integration';
import { createRoom, findOpenRoomByExternalRef, getRoom } from '@/lib/rooms';
import { firstIssue } from '@/lib/validation';

const bodySchema = z.object({
  matchCode: z.string().trim().regex(/^[A-Z0-9]{4,12}$/, 'Invalid match code'),
  title: z.string().trim().min(3).max(150),
});

// Server-to-server: the CricScore API asks for the camera room of a match (created on first call)
// and gets back a host token for the camera phone. Authenticated with INTEGRATION_SECRET.
export async function POST(req: Request) {
  if (!isIntegrationRequest(req)) return jsonError('Unauthorized', 401);
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(firstIssue(parsed.error), 400);
  const { matchCode, title } = parsed.data;

  try {
    const owner = await getIntegrationUser();
    const ref = `cricscore:${matchCode}`;
    let room = await findOpenRoomByExternalRef(ref);
    if (!room) room = await getRoom(await createRoom(owner.id, title, `Live cricket from CricScore · Match ${matchCode}`, ref));
    const hostToken = await createHostToken({ userId: owner.id, name: owner.name, role: 'USER', scope: room!.room_id });
    return NextResponse.json({ roomId: room!.room_id, status: room!.status, hostToken });
  } catch (err) {
    console.error('[integration:cricscore]', err);
    return jsonError('Could not create the camera room', 500);
  }
}
