import { NextResponse } from 'next/server';
import { isSameOrigin, jsonError } from '@/lib/http';
import { rebuildMatchVideo, FULL_SEGMENT } from '@/lib/match-video';
import { markRecordingReady } from '@/lib/recordings';
import { requireRecordingControl } from '@/lib/room-access';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return jsonError('Forbidden', 403);
  const access = await requireRecordingControl((await params).id);
  if ('error' in access) return access.error;
  const { recording } = access;
  await markRecordingReady(recording.id);
  // A part finished after the stream ended (uploaded later from the phone): the full match video
  // was built without it, so build it again
  if (recording.room_status === 'ENDED' && recording.segment !== FULL_SEGMENT) rebuildMatchVideo(recording.room_id);
  return NextResponse.json({ ok: true });
}
