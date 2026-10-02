import { NextResponse } from 'next/server';
import { z } from 'zod';
import { saveBallClip } from '@/lib/highlights';
import { isSameOrigin, jsonError } from '@/lib/http';
import { requireRoomControl } from '@/lib/room-access';
import { firstIssue } from '@/lib/validation';

const metaSchema = z.object({
  innings: z.number().int().min(1).max(4),
  delivery: z.number().int().min(1).max(2000),
  over: z.string().trim().max(10),
  kind: z.string().trim().max(8),
  label: z.string().trim().max(40),
  caption: z.string().trim().max(300).default(''),
  trimStart: z.number().min(0).max(120),
});
const MAX_BYTES = 30 * 1024 * 1024;

// Camera device uploads the replay clip of the ball that was just scored (multipart: meta + clip pieces)
export async function POST(req: Request, { params }: { params: Promise<{ roomId: string }> }) {
  if (!isSameOrigin(req)) return jsonError('Forbidden', 403);
  const access = await requireRoomControl((await params).roomId);
  if ('error' in access) return access.error;
  if (!access.room.external_ref) return jsonError('Ball replays are only for CricScore matches', 400);
  if (Number(req.headers.get('content-length') || 0) > MAX_BYTES) return jsonError('Clip too large', 413);

  const form = await req.formData().catch(() => null);
  let raw: unknown = null;
  try {
    raw = JSON.parse(String(form?.get('meta') ?? 'null'));
  } catch {}
  const meta = metaSchema.safeParse(raw);
  if (!meta.success) return jsonError(firstIssue(meta.error), 400);
  const files = (form?.getAll('clip') ?? []).filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length || files.length > 40) return jsonError('No video in the upload', 400);

  const parts = await Promise.all(files.map(async (f) => ({ data: Buffer.from(await f.arrayBuffer()), type: f.type })));
  const id = await saveBallClip(access.room, meta.data, parts);
  return NextResponse.json({ id }, { status: 202 });
}
