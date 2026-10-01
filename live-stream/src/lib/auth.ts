import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';

// Shared by Next.js route handlers and the Socket.IO server; must not import next/* modules.

export const SESSION_COOKIE = 'ls_session';
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type UserRole = 'USER' | 'ADMIN';
export interface Session {
  userId: number;
  name: string;
  role: UserRole;
  // Set for camera-phone sessions handed out by an integration: the holder may only broadcast this room
  scope: string | null;
}

const HOST_TOKEN_TTL_SECONDS = 60 * 60 * 24;

function getSecret(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be set to at least 32 characters.');
  }
  return new TextEncoder().encode(secret);
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

// Compared against when the email is unknown, so login timing doesn't reveal which emails exist
let dummyHash: Promise<string> | null = null;

export async function verifyPassword(password: string, hash: string | null): Promise<boolean> {
  if (hash) return bcrypt.compare(password, hash);
  dummyHash ??= bcrypt.hash('timing-equaliser', 12);
  await bcrypt.compare(password, await dummyHash);
  return false;
}

type TokenType = 'session' | 'host';

function signToken(session: Session, typ: TokenType, ttlSeconds: number): Promise<string> {
  return new SignJWT({ typ, name: session.name, role: session.role, ...(session.scope ? { scope: session.scope } : {}) })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(session.userId))
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(getSecret());
}

async function verifyToken(token: string, typ: TokenType): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] });
    if ((payload.typ ?? 'session') !== typ) return null;
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || userId <= 0) return null;
    return {
      userId,
      name: String(payload.name ?? ''),
      role: payload.role === 'ADMIN' ? 'ADMIN' : 'USER',
      scope: typeof payload.scope === 'string' ? payload.scope : null,
    };
  } catch {
    return null;
  }
}

export const createSessionToken = (session: Session) => signToken(session, 'session', SESSION_MAX_AGE_SECONDS);
export const verifySessionToken = (token: string) => verifyToken(token, 'session');

// Single-room link for a camera phone; exchanged for a scoped session cookie at /host
export const createHostToken = (session: Session) => signToken(session, 'host', HOST_TOKEN_TTL_SECONDS);
export const verifyHostToken = (token: string) => verifyToken(token, 'host');

// Room owner, and (for scoped camera sessions) only the room the session was issued for
export function canControlRoom(session: Session | null, room: { broadcaster_id: number; room_id: string }): boolean {
  return !!session && session.userId === room.broadcaster_id && (!session.scope || session.scope === room.room_id);
}
