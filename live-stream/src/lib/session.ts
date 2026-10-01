import 'server-only';
import { cookies, headers } from 'next/headers';
import { BASE_PATH } from './paths';
import { SESSION_COOKIE, SESSION_MAX_AGE_SECONDS, verifySessionToken, type Session } from './auth';

export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verifySessionToken(token) : null;
}

// Secure when the browser reached us over https, directly or through a proxy/tunnel
async function isHttps(): Promise<boolean> {
  const proto = (await headers()).get('x-forwarded-proto')?.split(',')[0]?.trim();
  return proto === 'https' || (process.env.NEXT_PUBLIC_APP_URL ?? '').startsWith('https://');
}

export async function setSessionCookie(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: await isHttps(),
    path: BASE_PATH || '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete({ name: SESSION_COOKIE, path: BASE_PATH || '/' });
}

// Account pages need a full login; a camera-phone session only reaches its own room
export async function getAccountSession(): Promise<Session | null> {
  const session = await getSession();
  return session && !session.scope ? session : null;
}
