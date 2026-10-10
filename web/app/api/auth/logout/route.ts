// POST /api/auth/logout -> deletes the session, clears the cookie, { success: true }
import { handleAuth, json, logout, readSessionCookie, sessionCookie } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (request: Request) =>
  handleAuth(async () => {
    await logout(readSessionCookie(request));
    return json(200, { success: true }, { 'Set-Cookie': sessionCookie(request, null) });
  });
