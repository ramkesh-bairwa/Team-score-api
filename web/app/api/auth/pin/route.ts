// POST /api/auth/pin { mobile, pin } -> sets the cs_session cookie, { success, user } (website login only)
import { handleAuth, json, loginWithPin, readBody, sessionCookie } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (request: Request) =>
  handleAuth(async () => {
    const { token, user } = await loginWithPin(await readBody(request));
    return json(200, { success: true, user }, { 'Set-Cookie': sessionCookie(request, token) });
  });
