import { NextResponse } from 'next/server';
import { createSessionToken, verifyPassword } from '@/lib/auth';
import { isSameOrigin, jsonError } from '@/lib/http';
import { setSessionCookie } from '@/lib/session';
import { findUserByEmail } from '@/lib/users';
import { firstIssue, loginSchema } from '@/lib/validation';

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError('Forbidden', 403);
  const parsed = loginSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(firstIssue(parsed.error), 400);
  const { email, password } = parsed.data;

  try {
    const user = await findUserByEmail(email);
    const valid = await verifyPassword(password, user?.password_hash ?? null);
    if (!user || !valid) return jsonError('Invalid email or password', 401);
    await setSessionCookie(await createSessionToken({ userId: user.id, name: user.name, role: user.role, scope: null }));
    return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email } });
  } catch (err) {
    console.error('[login]', err);
    return jsonError('Could not sign in', 500);
  }
}
