// POST /api/auth/otp { mobile, name? } -> { success, otp, expiresIn, isNewUser } (website login only)
import { handleAuth, json, readBody, requestOtp } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = (request: Request) =>
  handleAuth(async () => json(200, await requestOtp(await readBody(request))));
