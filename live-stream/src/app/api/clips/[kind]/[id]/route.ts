import { getClipFile } from '@/lib/highlights';
import { jsonError } from '@/lib/http';
import { serveVideo } from '@/lib/serve-file';

// Public: a ball replay clip (/api/clips/ball/<id>) or an innings video (/api/clips/innings/<id>)
export async function GET(req: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const { kind, id } = await params;
  const n = Number(id);
  const clip = Number.isInteger(n) && n > 0 ? await getClipFile(kind, n) : null;
  if (!clip) return jsonError('Video not found', 404);
  return serveVideo(req, clip.file, clip.mime);
}
