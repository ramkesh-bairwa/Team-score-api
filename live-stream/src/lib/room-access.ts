import 'server-only';
import { canControlRoom, type Session } from './auth';
import { jsonError } from './http';
import { getRecordingWithRoom } from './recordings';
import { getRoom, type RoomRow } from './rooms';
import { getSession } from './session';
import { roomIdSchema } from './validation';

type Denied = { error: Response };

// Owner (or the room's scoped camera session) only
export async function requireRoomControl(rawRoomId: string): Promise<{ session: Session; room: RoomRow } | Denied> {
  const parsed = roomIdSchema.safeParse(rawRoomId);
  if (!parsed.success) return { error: jsonError('Room not found', 404) };
  const [session, room] = await Promise.all([getSession(), getRoom(parsed.data)]);
  if (!room) return { error: jsonError('Room not found', 404) };
  if (!session) return { error: jsonError('Sign in required', 401) };
  if (!canControlRoom(session, room)) return { error: jsonError('Not allowed', 403) };
  return { session, room };
}

export async function requireRecordingControl(rawId: string) {
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) return { error: jsonError('Recording not found', 404) } as Denied;
  const [session, recording] = await Promise.all([getSession(), getRecordingWithRoom(id)]);
  if (!recording) return { error: jsonError('Recording not found', 404) } as Denied;
  if (!session) return { error: jsonError('Sign in required', 401) } as Denied;
  if (!canControlRoom(session, recording)) return { error: jsonError('Not allowed', 403) } as Denied;
  return { session, recording };
}
