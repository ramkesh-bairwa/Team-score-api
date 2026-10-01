import { NextResponse } from 'next/server';
import { isSameOrigin, jsonError } from '@/lib/http';
import { clearSessionCookie } from '@/lib/session';

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError('Forbidden', 403);
  await clearSessionCookie();
  return NextResponse.json({ ok: true });
}
