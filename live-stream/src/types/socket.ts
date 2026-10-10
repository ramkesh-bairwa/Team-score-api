// broadcaster = the camera device; remote = another device of the room owner that controls replays
export type Role = 'broadcaster' | 'viewer' | 'remote';
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
  'join-room': (payload: { roomId: string; role: Role; device?: DeviceInfo }, ack: (res: JoinRoomAck) => void) => void;
  'leave-room': () => void;
  'stream-started': (ack: (res: Ack) => void) => void;
  'stream-stopped': (ack: (res: Ack) => void) => void;
  'stream-ended': (ack: (res: Ack) => void) => void;
  offer: (payload: { to: string; sdp: SdpPayload }) => void;
  answer: (payload: { to: string; sdp: SdpPayload }) => void;
  'ice-candidate': (payload: { to: string; candidate: IceCandidatePayload }) => void;
  // Studio (camera + remotes of the room owner)
  'set-device-name': (payload: { name: string }) => void;
  'camera-state': (payload: CameraState) => void;
  'remote-command': (payload: ReplayCommand, ack: (res: Ack) => void) => void;
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
  'replay-command': (payload: ReplayCommand & { by?: string }) => void;
  // Every device of the studio: who is connected, and what the camera is doing
  'studio-update': (payload: StudioState) => void;
}

export type ReplayCommand =
  | { action: 'start'; seconds: number; rate: number }
  | { action: 'stop' }
  // A ball clip from the server, by its URL
  | { action: 'clip'; url: string };

// Kept on the device (localStorage) so it keeps its number and name across reloads
export interface DeviceInfo {
  id: string;
  name: string;
}

export interface StudioDevice {
  id: string;
  number: number;
  name: string;
  role: 'camera' | 'remote';
  online: boolean;
}

// Reported by the camera device whenever it changes
export interface CameraState {
  phase: 'preview' | 'live';
  replaySupported: boolean;
  replayAvailable: number; // seconds of footage a replay can show
  replaying: { rate: number; progress: number } | null;
  aspect: number;
}

export interface StudioState {
  devices: StudioDevice[];
  camera: CameraState | null;
}

export interface SocketData {
  userId: number | null;
  scope: string | null;
  roomId: string | null;
  role: Role | null;
  viewerSessionId: number | null;
  deviceId: string | null;
}
