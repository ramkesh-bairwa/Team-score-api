import type { Server, Socket } from 'socket.io';
import { parseCookie } from 'cookie';
import { SESSION_COOKIE, canControlRoom, verifySessionToken } from '../lib/auth';
import { markRoomRecordingsReady, failInterruptedUploads } from '../lib/recordings';
import { buildMatchVideo, resumeMatchVideos } from '../lib/match-video';
import { resumeHighlights } from '../lib/highlights';
import { captureMatchResult } from '../lib/match-result';
import { iceSignalSchema, joinRoomSchema, sdpSignalSchema } from '../lib/validation';
import * as rooms from '../lib/rooms';
import type {
  Ack,
  ClientToServerEvents,
  JoinRoomAck,
  ServerToClientEvents,
  SocketData,
} from '../types/socket';

// Socket.IO carries signaling and presence only. Audio/video flows peer-to-peer over WebRTC
// (one RTCPeerConnection per viewer, opened by the broadcaster).

export type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

interface RoomState {
  dbId: number;
  broadcasterUserId: number;
  broadcasterSocketId: string | null;
  live: boolean;
  viewers: Map<string, number>; // socket id → viewer_sessions.id
  endTimer: NodeJS.Timeout | null;
}

const GRACE_MS = Number(process.env.BROADCASTER_RECONNECT_GRACE_MS ?? 60_000);

// Socket.IO room names are namespaced so they can never collide with socket ids
const channel = (roomId: string) => `room:${roomId}`;

const reply = <T>(ack: unknown, value: T) => {
  if (typeof ack === 'function') ack(value);
};

export function registerSocketHandlers(io: IO): void {
  const state = new Map<string, RoomState>();

  rooms.closeDanglingViewerSessions().catch((err) => console.error('[socket] closing stale sessions failed', err));
  failInterruptedUploads()
    .then(resumeMatchVideos)
    .then(resumeHighlights)
    .catch((err) => console.error('[socket] resetting interrupted uploads failed', err));

  // Identify logged-in users from the HTTP-only session cookie; anonymous viewers are allowed
  io.use(async (socket, next) => {
    socket.data = { userId: null, scope: null, roomId: null, role: null, viewerSessionId: null };
    const cookieHeader = socket.handshake.headers.cookie;
    const token = cookieHeader ? parseCookie(cookieHeader)[SESSION_COOKIE] : undefined;
    if (token) {
      const session = await verifySessionToken(token);
      if (session) {
        socket.data.userId = session.userId;
        socket.data.scope = session.scope;
      }
    }
    next();
  });

  const emitViewerCount = (roomId: string) => {
    const room = state.get(roomId);
    io.to(channel(roomId)).emit('viewer-count-updated', { count: room?.viewers.size ?? 0 });
  };

  const disposeIfIdle = (roomId: string) => {
    const room = state.get(roomId);
    if (room && !room.live && !room.broadcasterSocketId && room.viewers.size === 0) {
      if (room.endTimer) clearTimeout(room.endTimer);
      state.delete(roomId);
    }
  };

  const scheduleEnd = (roomId: string, room: RoomState) => {
    if (room.endTimer) clearTimeout(room.endTimer);
    room.endTimer = setTimeout(() => {
      endRoom(roomId).catch((err) => console.error('[socket] auto-end failed', err));
    }, GRACE_MS);
  };

  const endRoom = async (roomId: string) => {
    const room = state.get(roomId);
    if (room?.endTimer) clearTimeout(room.endTimer);
    state.delete(roomId);
    await rooms.markRoomEnded(roomId);
    if (room) {
      await rooms.closeAllViewerSessions(room.dbId);
      await markRoomRecordingsReady(room.dbId);
    }
    buildMatchVideo(roomId);
    rooms.getRoom(roomId).then((r) => captureMatchResult(r?.external_ref ?? null)).catch(() => {});
    io.to(channel(roomId)).emit('stream-ended');
    for (const id of io.sockets.adapter.rooms.get(channel(roomId)) ?? []) {
      const s = io.sockets.sockets.get(id);
      if (s) s.data = { ...s.data, roomId: null, role: null, viewerSessionId: null };
    }
    io.in(channel(roomId)).socketsLeave(channel(roomId));
  };

  const leaveCurrentRoom = async (socket: AppSocket) => {
    const { roomId, role, viewerSessionId } = socket.data;
    if (!roomId) return;
    socket.data = { ...socket.data, roomId: null, role: null, viewerSessionId: null };
    socket.leave(channel(roomId));
    const room = state.get(roomId);
    if (!room) return;

    if (role === 'viewer') {
      room.viewers.delete(socket.id);
      if (viewerSessionId) await rooms.closeViewerSession(viewerSessionId);
      if (room.broadcasterSocketId) io.to(room.broadcasterSocketId).emit('viewer-left', { viewerId: socket.id });
      emitViewerCount(roomId);
    } else if (role === 'broadcaster' && room.broadcasterSocketId === socket.id) {
      room.broadcasterSocketId = null;
      io.to(channel(roomId)).emit('broadcaster-disconnected');
      // Give the broadcaster time to reconnect (network blip, page refresh) before ending
      if (room.live) scheduleEnd(roomId, room);
    }
    disposeIfIdle(roomId);
  };

  io.on('connection', (socket: AppSocket) => {
    socket.on('join-room', async (payload, ack) => {
      const parsed = joinRoomSchema.safeParse(payload);
      if (!parsed.success) return reply<JoinRoomAck>(ack, { ok: false, code: 'INVALID', error: 'Invalid room' });
      const { roomId, role } = parsed.data;

      try {
        await leaveCurrentRoom(socket);
        const row = await rooms.getRoom(roomId);
        if (!row) return reply<JoinRoomAck>(ack, { ok: false, code: 'NOT_FOUND', error: 'Room not found' });
        if (row.status === 'ENDED') {
          return reply<JoinRoomAck>(ack, { ok: false, code: 'ENDED', error: 'This stream has ended' });
        }

        let room = state.get(roomId);
        if (!room) {
          room = {
            dbId: row.id,
            broadcasterUserId: row.broadcaster_id,
            broadcasterSocketId: null,
            live: row.status === 'LIVE',
            viewers: new Map(),
            endTimer: null,
          };
          state.set(roomId, room);
          // LIVE in the DB but nobody is broadcasting (e.g. after a server restart)
          if (room.live) scheduleEnd(roomId, room);
        }

        if (role === 'broadcaster') {
          const session = socket.data.userId
            ? { userId: socket.data.userId, name: '', role: 'USER' as const, scope: socket.data.scope }
            : null;
          if (!canControlRoom(session, { broadcaster_id: room.broadcasterUserId, room_id: roomId })) {
            return reply<JoinRoomAck>(ack, { ok: false, code: 'FORBIDDEN', error: 'Only the room owner can broadcast' });
          }
          const current = room.broadcasterSocketId;
          if (current && current !== socket.id && io.sockets.sockets.has(current)) {
            return reply<JoinRoomAck>(ack, {
              ok: false,
              code: 'BROADCASTER_EXISTS',
              error: 'This room is already being broadcast from another tab or device',
            });
          }
          room.broadcasterSocketId = socket.id;
          if (room.endTimer) {
            clearTimeout(room.endTimer);
            room.endTimer = null;
          }
          socket.data = { ...socket.data, roomId, role, viewerSessionId: null };
          socket.join(channel(roomId));
        } else {
          const sessionId = await rooms.openViewerSession(room.dbId, socket.data.userId, socket.id);
          room.viewers.set(socket.id, sessionId);
          socket.data = { ...socket.data, roomId, role, viewerSessionId: sessionId };
          socket.join(channel(roomId));
          if (room.live && room.broadcasterSocketId) {
            io.to(room.broadcasterSocketId).emit('viewer-joined', { viewerId: socket.id });
          }
          emitViewerCount(roomId);
        }

        reply<JoinRoomAck>(ack, {
          ok: true,
          role,
          status: room.live ? 'LIVE' : 'WAITING',
          broadcasterOnline: !!room.broadcasterSocketId,
          viewerCount: room.viewers.size,
        });
      } catch (err) {
        console.error('[socket] join-room failed', err);
        reply<JoinRoomAck>(ack, { ok: false, code: 'SERVER', error: 'Could not join the room' });
      }
    });

    socket.on('leave-room', () => {
      leaveCurrentRoom(socket).catch((err) => console.error('[socket] leave-room failed', err));
    });

    // Returns the room if this socket is its active broadcaster
    const ownRoom = (): [string, RoomState] | null => {
      const { roomId, role } = socket.data;
      if (!roomId || role !== 'broadcaster') return null;
      const room = state.get(roomId);
      return room && room.broadcasterSocketId === socket.id ? [roomId, room] : null;
    };

    socket.on('stream-started', async (ack) => {
      const owned = ownRoom();
      if (!owned) return reply<Ack>(ack, { ok: false, error: 'Not the broadcaster of this room' });
      const [roomId, room] = owned;
      try {
        await rooms.markRoomLive(roomId);
        room.live = true;
        reply<Ack>(ack, { ok: true });
        socket.to(channel(roomId)).emit('stream-started');
        // Ask the broadcaster to open a peer connection to everyone already waiting
        for (const viewerId of room.viewers.keys()) socket.emit('viewer-joined', { viewerId });
      } catch (err) {
        console.error('[socket] stream-started failed', err);
        reply<Ack>(ack, { ok: false, error: 'Could not start the stream' });
      }
    });

    socket.on('stream-stopped', async (ack) => {
      const owned = ownRoom();
      if (!owned) return reply<Ack>(ack, { ok: false, error: 'Not the broadcaster of this room' });
      const [roomId, room] = owned;
      try {
        await rooms.markRoomWaiting(roomId);
        room.live = false;
        socket.to(channel(roomId)).emit('stream-stopped');
        reply<Ack>(ack, { ok: true });
      } catch (err) {
        console.error('[socket] stream-stopped failed', err);
        reply<Ack>(ack, { ok: false, error: 'Could not stop the stream' });
      }
    });

    socket.on('stream-ended', async (ack) => {
      const owned = ownRoom();
      if (!owned) return reply<Ack>(ack, { ok: false, error: 'Not the broadcaster of this room' });
      try {
        await endRoom(owned[0]);
        reply<Ack>(ack, { ok: true });
      } catch (err) {
        console.error('[socket] stream-ended failed', err);
        reply<Ack>(ack, { ok: false, error: 'Could not end the stream' });
      }
    });

    // ── Signaling relay ─────────────────────────────────────
    // Only between the broadcaster and a viewer of the same room, in the right direction.
    const relayTarget = (to: string, expected: 'broadcaster' | 'viewer') => {
      const { roomId, role } = socket.data;
      if (!roomId || !role || role === expected) return null;
      const target = io.sockets.sockets.get(to);
      if (!target || target.data.roomId !== roomId || target.data.role !== expected) return null;
      return target;
    };

    socket.on('offer', (payload) => {
      const parsed = sdpSignalSchema.safeParse(payload);
      if (!parsed.success || parsed.data.sdp.type !== 'offer' || socket.data.role !== 'broadcaster') return;
      relayTarget(parsed.data.to, 'viewer')?.emit('offer', { from: socket.id, sdp: parsed.data.sdp });
    });

    socket.on('answer', (payload) => {
      const parsed = sdpSignalSchema.safeParse(payload);
      if (!parsed.success || parsed.data.sdp.type !== 'answer' || socket.data.role !== 'viewer') return;
      relayTarget(parsed.data.to, 'broadcaster')?.emit('answer', { from: socket.id, sdp: parsed.data.sdp });
    });

    socket.on('ice-candidate', (payload) => {
      const parsed = iceSignalSchema.safeParse(payload);
      if (!parsed.success) return;
      const expected = socket.data.role === 'broadcaster' ? 'viewer' : 'broadcaster';
      relayTarget(parsed.data.to, expected)?.emit('ice-candidate', {
        from: socket.id,
        candidate: parsed.data.candidate,
      });
    });

    socket.on('disconnect', () => {
      leaveCurrentRoom(socket).catch((err) => console.error('[socket] disconnect cleanup failed', err));
    });
  });
}
