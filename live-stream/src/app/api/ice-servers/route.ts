import { NextResponse } from 'next/server';

// TURN credentials stay out of the client bundle and are handed to the page at runtime.
// Every viewer needs them to relay media, so use short-lived or rate-limited TURN credentials in production.
export const dynamic = 'force-dynamic';

export function GET() {
  const iceServers: RTCIceServer[] = [];
  const stun = process.env.NEXT_PUBLIC_STUN_SERVER;
  if (stun) iceServers.push({ urls: stun.split(',').map((s) => s.trim()) });

  const { TURN_SERVER, TURN_USERNAME, TURN_PASSWORD } = process.env;
  if (TURN_SERVER) {
    iceServers.push({
      urls: TURN_SERVER.split(',').map((s) => s.trim()),
      username: TURN_USERNAME || undefined,
      credential: TURN_PASSWORD || undefined,
    });
  }
  return NextResponse.json({ iceServers }, { headers: { 'Cache-Control': 'no-store' } });
}
