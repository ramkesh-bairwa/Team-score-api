import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import BroadcasterView from '@/components/BroadcasterView';
import ViewerView from '@/components/ViewerView';
import { getRoom } from '@/lib/rooms';
import { canControlRoom } from '@/lib/auth';
import { getSession } from '@/lib/session';
import { roomIdSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ roomId: string }> };

async function loadRoom(params: Params['params']) {
  const parsed = roomIdSchema.safeParse((await params).roomId);
  return parsed.success ? getRoom(parsed.data) : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const room = await loadRoom(params);
  return { title: room ? `${room.title} · LiveStream` : 'Stream not found' };
}

export default async function LiveRoomPage({ params }: Params) {
  const [room, session] = await Promise.all([loadRoom(params), getSession()]);
  if (!room) notFound();

  // The room owner gets the studio; everyone else (including anonymous visitors) watches
  if (canControlRoom(session, room)) {
    return (
      <BroadcasterView
        roomId={room.room_id}
        title={room.title}
        description={room.description}
        initialStatus={room.status}
        hasScoreOverlay={!!room.external_ref}
      />
    );
  }
  return (
    <ViewerView
      roomId={room.room_id}
      title={room.title}
      description={room.description}
      broadcasterName={room.broadcaster_name}
      initialStatus={room.status}
      isMatch={!!room.external_ref}
    />
  );
}
