import type { ReplayCommand } from '../types/socket';

// Bridge from Next.js route handlers to the Socket.IO server. Both run in one process but are
// loaded as separate module graphs, so the sender lives on globalThis.
type Sender = (roomId: string, cmd: ReplayCommand) => boolean;
const KEY = '__cricscoreReplaySender';
const slot = globalThis as unknown as Record<string, Sender | undefined>;

export function setReplaySender(fn: Sender) {
  slot[KEY] = fn;
}

// true when the camera device was live and got the command
export function sendReplayCommand(roomId: string, cmd: ReplayCommand): boolean {
  return slot[KEY]?.(roomId, cmd) ?? false;
}
