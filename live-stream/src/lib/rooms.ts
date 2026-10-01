import { randomBytes } from 'node:crypto';
import { execute, queryOne, queryRows } from './db';
import type { RoomStatus } from '../types/socket';

export interface RoomRow {
  id: number;
  room_id: string;
  title: string;
  description: string | null;
  broadcaster_id: number;
  broadcaster_name: string;
  external_ref: string | null;
  status: RoomStatus;
  started_at: Date | null;
  ended_at: Date | null;
  created_at: Date;
}

const ROOM_COLUMNS = `r.id, r.room_id, r.title, r.description, r.broadcaster_id, u.name AS broadcaster_name,
  r.external_ref, r.status, r.started_at, r.ended_at, r.created_at`;

export async function createRoom(
  broadcasterId: number,
  title: string,
  description: string,
  externalRef: string | null = null,
): Promise<string> {
  // 12 URL-safe chars ≈ 72 bits of entropy; retry on the (unlikely) unique-key collision
  for (let attempt = 0; attempt < 3; attempt++) {
    const roomId = randomBytes(9).toString('base64url');
    try {
      await execute(
        'INSERT INTO live_rooms (room_id, title, description, broadcaster_id, external_ref) VALUES (?, ?, ?, ?, ?)',
        [roomId, title, description || null, broadcasterId, externalRef],
      );
      return roomId;
    } catch (err) {
      if ((err as { code?: string }).code !== 'ER_DUP_ENTRY') throw err;
    }
  }
  throw new Error('Could not allocate a unique room ID');
}

export function getRoom(roomId: string) {
  return queryOne<RoomRow>(
    `SELECT ${ROOM_COLUMNS} FROM live_rooms r JOIN users u ON u.id = r.broadcaster_id WHERE r.room_id = ? LIMIT 1`,
    [roomId],
  );
}

export function findOpenRoomByExternalRef(externalRef: string) {
  return queryOne<RoomRow>(
    `SELECT ${ROOM_COLUMNS} FROM live_rooms r JOIN users u ON u.id = r.broadcaster_id
     WHERE r.external_ref = ? AND r.status <> 'ENDED' ORDER BY r.created_at DESC LIMIT 1`,
    [externalRef],
  );
}

// Latest room for an external ref in any state: what a match's permanent watch link points at.
// The newest room is also the one the camera link opens (findOpenRoomByExternalRef).
export function findLatestRoomByExternalRef(externalRef: string) {
  return queryOne<RoomRow>(
    `SELECT ${ROOM_COLUMNS} FROM live_rooms r JOIN users u ON u.id = r.broadcaster_id
     WHERE r.external_ref = ? ORDER BY r.created_at DESC, r.id DESC LIMIT 1`,
    [externalRef],
  );
}

export function listRoomsByBroadcaster(broadcasterId: number) {
  return queryRows<RoomRow>(
    `SELECT ${ROOM_COLUMNS} FROM live_rooms r JOIN users u ON u.id = r.broadcaster_id
     WHERE r.broadcaster_id = ? ORDER BY r.created_at DESC LIMIT 50`,
    [broadcasterId],
  );
}

export function listLiveRooms() {
  return queryRows<RoomRow>(
    `SELECT ${ROOM_COLUMNS} FROM live_rooms r JOIN users u ON u.id = r.broadcaster_id
     WHERE r.status = 'LIVE' ORDER BY r.started_at DESC LIMIT 24`,
  );
}

export async function markRoomLive(roomId: string): Promise<void> {
  await execute(
    "UPDATE live_rooms SET status = 'LIVE', started_at = COALESCE(started_at, UTC_TIMESTAMP()) WHERE room_id = ? AND status <> 'ENDED'",
    [roomId],
  );
}

export async function markRoomWaiting(roomId: string): Promise<void> {
  await execute("UPDATE live_rooms SET status = 'WAITING' WHERE room_id = ? AND status = 'LIVE'", [roomId]);
}

export async function markRoomEnded(roomId: string): Promise<void> {
  await execute(
    "UPDATE live_rooms SET status = 'ENDED', ended_at = UTC_TIMESTAMP() WHERE room_id = ? AND status <> 'ENDED'",
    [roomId],
  );
}

export async function openViewerSession(liveRoomId: number, userId: number | null, socketId: string): Promise<number> {
  const result = await execute(
    'INSERT INTO viewer_sessions (live_room_id, user_id, socket_id) VALUES (?, ?, ?)',
    [liveRoomId, userId, socketId],
  );
  return result.insertId;
}

export async function closeViewerSession(sessionId: number): Promise<void> {
  await execute('UPDATE viewer_sessions SET left_at = UTC_TIMESTAMP() WHERE id = ? AND left_at IS NULL', [sessionId]);
}

export async function closeAllViewerSessions(liveRoomId: number): Promise<void> {
  await execute(
    'UPDATE viewer_sessions SET left_at = UTC_TIMESTAMP() WHERE live_room_id = ? AND left_at IS NULL',
    [liveRoomId],
  );
}

// After a server restart no sockets survive, so any open session is stale
export async function closeDanglingViewerSessions(): Promise<void> {
  await execute('UPDATE viewer_sessions SET left_at = UTC_TIMESTAMP() WHERE left_at IS NULL');
}
