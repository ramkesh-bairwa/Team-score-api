import { NextResponse } from 'next/server';
import { createSessionToken, verifyHostToken } from '@/lib/auth';
import { withBase } from '@/lib/paths';
import { setSessionCookie } from '@/lib/session';

// Exchanges a camera-phone host link for a session cookie scoped to one room, then opens its studio.
// The token is removed from the address bar by the redirect.
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  const session = token ? await verifyHostToken(token) : null;
  const origin = publicOrigin(req);
  if (!session?.scope) return NextResponse.redirect(`${origin}${withBase('/host-expired')}`);
  await setSessionCookie(await createSessionToken(session));
  return NextResponse.redirect(`${origin}${withBase(`/live/${session.scope}`)}`);
}

// Behind a proxy/tunnel req.url is the internal address; rebuild the one the browser used
function publicOrigin(req: Request): string {
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host'))?.split(',')[0].trim();
  const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? new URL(req.url).protocol.replace(':', '');
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}
