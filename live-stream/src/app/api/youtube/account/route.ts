import { NextResponse } from 'next/server';
import { isSameOrigin, jsonError } from '@/lib/http';
import { getSession } from '@/lib/session';
import { disconnectYouTube, getYouTubeAccount, isYouTubeConfigured } from '@/lib/youtube';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await getSession();
  if (!session) return jsonError('Sign in required', 401);
  const account = await getYouTubeAccount(session.userId);
  return NextResponse.json({ configured: isYouTubeConfigured(), channelTitle: account?.channel_title ?? null });
}

export async function DELETE(req: Request) {
  if (!isSameOrigin(req)) return jsonError('Forbidden', 403);
  const session = await getSession();
  if (!session) return jsonError('Sign in required', 401);
  await disconnectYouTube(session.userId);
  return NextResponse.json({ ok: true });
}
