import Link from 'next/link';
import { redirect } from 'next/navigation';
import { RoomStatusBadge } from '@/components/ui';
import { listRoomsByBroadcaster } from '@/lib/rooms';
import { getAccountSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

const dateFmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

export default async function DashboardPage() {
  const session = await getAccountSession();
  if (!session) redirect('/login?next=/dashboard');
  const rooms = await listRoomsByBroadcaster(session.userId);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Hi, {session.name}</h1>
          <p className="mt-1 text-sm text-zinc-400">Your live rooms</p>
        </div>
        <Link href="/create-live" className="rounded-lg bg-red-600 px-4 py-2 font-semibold hover:bg-red-500">
          + New live stream
        </Link>
      </div>

      {rooms.length === 0 ? (
        <div className="mt-10 rounded-xl border border-dashed border-white/15 p-10 text-center text-zinc-400">
          You haven’t created any streams yet.
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10 bg-zinc-900">
          {rooms.map((room) => (
            <li key={room.room_id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{room.title}</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {dateFmt.format(room.created_at)} · <span className="font-mono">{room.room_id}</span>
                </p>
              </div>
              <RoomStatusBadge status={room.status} />
              <Link
                href={`/live/${room.room_id}`}
                className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/20"
              >
                {room.status === 'ENDED' ? 'Recordings' : 'Open studio'}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
