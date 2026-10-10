// GET /api/auth/me -> { user } or 401 { error: 'Not logged in' }
import { handleAuth, json, readSessionCookie, userForToken } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = (request: Request) =>
  handleAuth(async () => {
    const user = await userForToken(readSessionCookie(request));
    return user ? json(200, { user }) : json(401, { error: 'Not logged in' });
  });
