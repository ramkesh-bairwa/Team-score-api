import { redirect } from 'next/navigation';
import { findLatestRoomByExternalRef } from '@/lib/rooms';

export const dynamic = 'force-dynamic';

// Permanent watch link for a CricScore match (/stream/match/<CODE>). It can be shared before the
// camera is set up and keeps working after the match, when it plays the full match video.
export default async function MatchPage({ params }: { params: Promise<{ code: string }> }) {
  const code = (await params).code.toUpperCase();
  const room = /^[A-Z0-9]{4,12}$/.test(code) ? await findLatestRoomByExternalRef(`cricscore:${code}`) : null;
  if (room) redirect(`/live/${room.room_id}`);

  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      {/* Check again every 15 s until the camera room exists */}
      <meta httpEquiv="refresh" content="15" />
      <p className="text-sm font-semibold tracking-widest text-red-400">MATCH {code}</p>
      <h1 className="mt-2 text-2xl font-bold">The live stream hasn’t started yet</h1>
      <p className="mt-2 text-zinc-400">Keep this page open. It will switch to the live video as soon as the camera goes live.</p>
    </div>
  );
}
