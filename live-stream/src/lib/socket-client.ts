import { io, type Socket } from 'socket.io-client';
import { BASE_PATH } from './paths';
import type { ClientToServerEvents, ServerToClientEvents } from '@/types/socket';

export type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createSocket(): ClientSocket {
  // Same origin as the page; the session cookie identifies the user
  return io({
    path: `${BASE_PATH}/socket.io`,
    withCredentials: true,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });
}
