import { NextResponse } from 'next/server';
import { isSameOrigin, jsonError } from '@/lib/http';
import { getSession } from '@/lib/session';
import { pollDeviceFlow } from '@/lib/youtube';

export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError('Forbidden', 403);
  const session = await getSession();
  if (!session) return jsonError('Sign in required', 401);
  try {
    return NextResponse.json(await pollDeviceFlow(session.userId));
  } catch (err) {
    return NextResponse.json({ status: 'error', error: (err as Error).message });
  }
}
