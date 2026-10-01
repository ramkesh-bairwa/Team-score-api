import { NextResponse } from 'next/server';
import { createSessionToken, hashPassword } from '@/lib/auth';
import { isSameOrigin, jsonError } from '@/lib/http';
import { setSessionCookie } from '@/lib/session';
import { createUser, findUserByEmail } from '@/lib/users';
import { firstIssue, registerSchema } from '@/lib/validation';

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError('Forbidden', 403);
  const parsed = registerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(firstIssue(parsed.error), 400);
  const { name, email, password } = parsed.data;

  try {
    if (await findUserByEmail(email)) return jsonError('An account with this email already exists', 409);
    const id = await createUser(name, email, await hashPassword(password));
    await setSessionCookie(await createSessionToken({ userId: id, name, role: 'USER', scope: null }));
    return NextResponse.json({ user: { id, name, email } }, { status: 201 });
  } catch (err) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
      return jsonError('An account with this email already exists', 409);
    }
    console.error('[register]', err);
    return jsonError('Could not create account', 500);
  }
}
