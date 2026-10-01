import { NextResponse } from 'next/server';
import { isSameOrigin, jsonError } from '@/lib/http';
import { getSession } from '@/lib/session';
import { isYouTubeConfigured, startDeviceFlow } from '@/lib/youtube';

// Starts "Connect YouTube": returns a code the user enters at google.com/device
export async function POST(req: Request) {
  if (!isSameOrigin(req)) return jsonError('Forbidden', 403);
  if (!isYouTubeConfigured()) return jsonError('YouTube uploads are not set up on this server yet', 503);
  const session = await getSession();
  if (!session) return jsonError('Sign in required', 401);
  try {
    return NextResponse.json(await startDeviceFlow(session.userId));
  } catch (err) {
    return jsonError((err as Error).message, 502);
  }
}
