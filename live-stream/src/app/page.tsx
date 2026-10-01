import Link from 'next/link';
import { listLiveRooms, type RoomRow } from '@/lib/rooms';
import { getAccountSession } from '@/lib/session';
import { LiveBadge } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const session = await getAccountSession();
  let liveRooms: RoomRow[] = [];
  let dbError = false;
  try {
    liveRooms = await listLiveRooms();
  } catch (err) {
    console.error('[home] listing live rooms failed', err);
    dbError = true;
  }

  return (
    <div className="mx-auto max-w-6xl px-4">
      <section className="py-16 sm:py-24">
        <p className="text-sm font-semibold uppercase tracking-widest text-red-400">Real-time · peer-to-peer</p>
        <h1 className="mt-3 max-w-2xl text-4xl font-black tracking-tight sm:text-6xl">
          Go live from your camera in one click.
        </h1>
        <p className="mt-4 max-w-xl text-lg text-zinc-400">
          Start a stream, share the link, and anyone can watch instantly in their browser. No plugins, no installs.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href={session ? '/create-live' : '/register'}
            className="rounded-lg bg-red-600 px-5 py-3 font-semibold hover:bg-red-500"
          >
            {session ? 'Start a live stream' : 'Get started free'}
          </Link>
          {session && (
            <Link href="/dashboard" className="rounded-lg bg-white/10 px-5 py-3 font-semibold hover:bg-white/20">
              Your streams
            </Link>
          )}
        </div>
      </section>

      <section className="pb-20">
        <h2 className="text-lg font-bold">Live now</h2>
        {dbError ? (
          <p className="mt-4 text-sm text-red-300">Could not load streams. Check the database connection.</p>
        ) : liveRooms.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-500">Nobody is live right now.</p>
        ) : (
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {liveRooms.map((room) => (
              <li key={room.room_id}>
                <Link
                  href={`/live/${room.room_id}`}
                  className="block rounded-xl border border-white/10 bg-zinc-900 p-4 transition hover:border-red-500/50"
                >
                  <LiveBadge />
                  <p className="mt-3 line-clamp-2 font-semibold">{room.title}</p>
                  <p className="mt-1 text-sm text-zinc-400">{room.broadcaster_name}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
