// POST /api/auth/verify { mobile, otp, name? } -> sets the cs_session cookie, { success, user }
import { handleAuth, json, readBody, sessionCookie, verifyOtp } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (request: Request) =>
  handleAuth(async () => {
    const { token, user } = await verifyOtp(await readBody(request));
    return json(200, { success: true, user }, { 'Set-Cookie': sessionCookie(request, token) });
  });
