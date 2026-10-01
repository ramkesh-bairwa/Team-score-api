import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/http';
import { getRoom } from '@/lib/rooms';
import { roomIdSchema } from '@/lib/validation';

export async function GET(_req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const parsed = roomIdSchema.safeParse((await params).roomId);
  if (!parsed.success) return jsonError('Room not found', 404);
  const room = await getRoom(parsed.data);
  if (!room) return jsonError('Room not found', 404);
  return NextResponse.json({
    room: {
      roomId: room.room_id,
      title: room.title,
      description: room.description,
      broadcasterName: room.broadcaster_name,
      status: room.status,
      startedAt: room.started_at,
      endedAt: room.ended_at,
    },
  });
}
