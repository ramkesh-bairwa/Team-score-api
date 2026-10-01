import { NextResponse } from 'next/server';
import { isSameOrigin, jsonError } from '@/lib/http';
import { markRecordingReady } from '@/lib/recordings';
import { requireRecordingControl } from '@/lib/room-access';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return jsonError('Forbidden', 403);
  const access = await requireRecordingControl((await params).id);
  if ('error' in access) return access.error;
  await markRecordingReady(access.recording.id);
  return NextResponse.json({ ok: true });
}
