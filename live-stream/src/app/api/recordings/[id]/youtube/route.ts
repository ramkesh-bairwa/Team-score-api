import { NextResponse } from 'next/server';
import { z } from 'zod';
import { isSameOrigin, jsonError } from '@/lib/http';
import { requireRecordingControl } from '@/lib/room-access';
import { getYouTubeAccount, isYouTubeConfigured, startUpload } from '@/lib/youtube';
import { firstIssue } from '@/lib/validation';

const bodySchema = z.object({
  title: z.string().trim().min(1).max(100),
  description: z.string().trim().max(5000).optional().default(''),
  privacy: z.enum(['private', 'unlisted', 'public']),
});

// Kicks off the upload; the client polls the room's recordings list for progress
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOrigin(req)) return jsonError('Forbidden', 403);
  if (!isYouTubeConfigured()) return jsonError('YouTube uploads are not set up on this server yet', 503);
  const access = await requireRecordingControl((await params).id);
  if ('error' in access) return access.error;
  const { recording, session } = access;
  if (!['READY', 'FAILED'].includes(recording.status)) {
    return jsonError(recording.status === 'RECORDING' ? 'The recording is still in progress' : 'Already uploaded or uploading', 409);
  }
  if (!Number(recording.size_bytes)) return jsonError('The recording is empty', 409);
  if (!(await getYouTubeAccount(session.userId))) return jsonError('Connect a YouTube channel first', 409);

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError(firstIssue(parsed.error), 400);
  startUpload(recording.id, session.userId, parsed.data);
  return NextResponse.json({ ok: true }, { status: 202 });
}
