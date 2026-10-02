export type Role = 'broadcaster' | 'viewer';
export type RoomStatus = 'WAITING' | 'LIVE' | 'ENDED';

export interface SdpPayload {
  type: 'offer' | 'answer';
  sdp: string;
}

export interface IceCandidatePayload {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type JoinErrorCode = 'INVALID' | 'NOT_FOUND' | 'ENDED' | 'FORBIDDEN' | 'BROADCASTER_EXISTS' | 'SERVER';

export type JoinRoomAck =
  | { ok: true; role: Role; status: RoomStatus; broadcasterOnline: boolean; viewerCount: number }
  | { ok: false; code: JoinErrorCode; error: string };

export type Ack = { ok: true } | { ok: false; error: string };

export interface ClientToServerEvents {
  'join-room': (payload: { roomId: string; role: Role }, ack: (res: JoinRoomAck) => void) => void;
  'leave-room': () => void;
  'stream-started': (ack: (res: Ack) => void) => void;
  'stream-stopped': (ack: (res: Ack) => void) => void;
  'stream-ended': (ack: (res: Ack) => void) => void;
  offer: (payload: { to: string; sdp: SdpPayload }) => void;
  answer: (payload: { to: string; sdp: SdpPayload }) => void;
  'ice-candidate': (payload: { to: string; candidate: IceCandidatePayload }) => void;
}

export interface ServerToClientEvents {
  'viewer-joined': (payload: { viewerId: string }) => void;
  'viewer-left': (payload: { viewerId: string }) => void;
  offer: (payload: { from: string; sdp: SdpPayload }) => void;
  answer: (payload: { from: string; sdp: SdpPayload }) => void;
  'ice-candidate': (payload: { from: string; candidate: IceCandidatePayload }) => void;
  'stream-started': () => void;
  'stream-stopped': () => void;
  'stream-ended': () => void;
  'viewer-count-updated': (payload: { count: number }) => void;
  'broadcaster-disconnected': () => void;
  // Sent to the camera device when the scorer's phone asks for a replay
  'replay-command': (payload: ReplayCommand) => void;
}

export type ReplayCommand = { action: 'start'; seconds: number; rate: number } | { action: 'stop' };

export interface SocketData {
  userId: number | null;
  scope: string | null;
  roomId: string | null;
  role: Role | null;
  viewerSessionId: number | null;
}
