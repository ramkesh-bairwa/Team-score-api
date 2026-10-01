import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { jsonError } from '@/lib/http';
import { recordingPath } from '@/lib/recordings';
import { requireRecordingControl } from '@/lib/room-access';

// Download a recording (owner only)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireRecordingControl((await params).id);
  if ('error' in access) return access.error;
  const rec = access.recording;
  const file = recordingPath(rec);
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return jsonError('Recording file is missing', 404);
  }
  const ext = rec.file_name.split('.').pop();
  const safeTitle = rec.title.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'recording';
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      'Content-Type': rec.mime_type,
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename="${safeTitle} - part ${rec.segment}.${ext}"`,
    },
  });
}
