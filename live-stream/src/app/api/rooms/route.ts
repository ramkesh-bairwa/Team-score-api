import { NextResponse } from 'next/server';
import { isSameOrigin, jsonError } from '@/lib/http';
import { createRoom, listRoomsByBroadcaster } from '@/lib/rooms';
import { getAccountSession } from '@/lib/session';
import { createRoomSchema, firstIssue } from '@/lib/validation';

export async function GET() {
  const session = await getAccountSession();
  if (!session) return jsonError('Sign in required', 401);
  const rooms = await listRoomsByBroadcaster(session.userId);
  return NextResponse.json({
    rooms: rooms.map((r) => ({ roomId: r.room_id, title: r.title, status: r.status, createdAt: r.created_at })),
  });
}

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError('Forbidden', 403);
  const session = await getAccountSession();
  if (!session) return jsonError('Sign in required', 401);

  const parsed = createRoomSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(firstIssue(parsed.error), 400);

  try {
    const roomId = await createRoom(session.userId, parsed.data.title, parsed.data.description);
    return NextResponse.json({ roomId }, { status: 201 });
  } catch (err) {
    console.error('[rooms:create]', err);
    return jsonError('Could not create the room', 500);
  }
}
