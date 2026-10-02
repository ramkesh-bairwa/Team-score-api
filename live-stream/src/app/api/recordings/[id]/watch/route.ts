import { jsonError } from '@/lib/http';
import { getRecordingWithRoom, recordingPath } from '@/lib/recordings';
import { getRoom } from '@/lib/rooms';
import { serveVideo } from '@/lib/serve-file';

// Public playback of a finished CricScore match (the stream itself was public). Supports Range
// requests so the player can seek through a long match. Other rooms' recordings stay owner-only.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const rec = Number.isInteger(id) && id > 0 ? await getRecordingWithRoom(id) : null;
  const room = rec ? await getRoom(rec.room_id) : null;
  if (!rec || !room?.external_ref || room.status !== 'ENDED' || rec.status === 'RECORDING') {
    return jsonError('Video not found', 404);
  }
  return serveVideo(req, recordingPath(rec), rec.mime_type);
}
