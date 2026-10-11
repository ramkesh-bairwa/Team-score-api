// Full-match recordings from the camera phone (/go/:code). New endpoints only; nothing the app or
// the old API used goes through here. The camera link's key (?k=) is the permission for a match.
//   POST /api/stream-rec/:code                 { k, target, mime, title, privacy, acct } -> { recording }
//   GET  /api/stream-rec/:code?k=              -> { recordings }
//   The scorer's phone uses the match's live-session token instead (?t= / { t }) to list, play,
//   download, delete or upload the match's recordings:
//   DELETE /api/stream-rec/:code/:id?t=        delete a recording
//   PUT  /api/stream-rec/:code/:id?k=&offset=  raw video bytes -> { bytes }  (409 { bytes } on a gap)
//   POST /api/stream-rec/:code/:id/finish      { k }
//   POST /api/stream-rec/:code/:id/youtube     { k, acct, privacy }   upload a stored recording
//   GET  /api/stream-rec/:code/:id/file?k=     download (&inline=1 to play; byte ranges for seeking)
//   GET  /api/stream-rec/youtube?acct=         { configured, connected, channelTitle, live }  (live: YouTube Live possible)
//   POST /api/stream-rec/youtube/connect       -> { acct, userCode, verificationUrl, interval }
//   GET  /api/stream-rec/youtube/poll?acct=    -> { status, channelTitle? }
//   POST /api/stream-rec/youtube/disconnect    { acct }
import { CODE_RE, rooms } from '@/lib/server/streamRooms';
import {
  appendPiece, createRecording, deleteRecording, disconnectAccount, fileStream, finishRecording, getAccount, getRecording,
  keyMatches, listAllRecordings, listRecordings, liveTokenOk, pollConnect, publicView, startConnect, startYouTubeUpload, validAcct, youtubeConfigured,
  type Privacy,
} from '@/lib/server/recordings';
import { hasFfmpeg } from '@/lib/server/ytLive';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PIECE = 4 * 1024 * 1024;
const PRIVACY: Privacy[] = ['unlisted', 'private', 'public'];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const fail = (status: number, error: string) => json({ error }, status);
const body = async (req: Request) => (await req.json().catch(() => ({}))) || {};

function parts(req: Request) {
  const url = new URL(req.url);
  const seg = url.pathname.replace(/^\/api\/stream-rec\/?/i, '').split('/').filter(Boolean);
  return { url, seg };
}

async function youtube(req: Request, action: string | undefined, url: URL) {
  if (req.method === 'GET' && !action && !youtubeConfigured()) return json({ configured: false, connected: false, live: await hasFfmpeg() });
  if (!youtubeConfigured()) return json({ configured: false, connected: false });
  if (req.method === 'GET' && !action) {
    const acct = url.searchParams.get('acct');
    const a = validAcct(acct) ? getAccount(acct) : null;
    return json({ configured: true, connected: !!a, channelTitle: a?.channelTitle || null, live: await hasFfmpeg() });
  }
  if (req.method === 'POST' && action === 'connect') {
    try {
      return json(await startConnect());
    } catch (e: any) {
      return fail(502, e.message);
    }
  }
  if (req.method === 'GET' && action === 'poll') {
    const acct = url.searchParams.get('acct');
    if (!validAcct(acct)) return fail(400, 'Invalid account');
    try {
      return json(await pollConnect(acct));
    } catch (e: any) {
      return json({ status: 'error', error: e.message });
    }
  }
  if (req.method === 'POST' && action === 'disconnect') {
    const { acct } = await body(req);
    if (validAcct(acct)) disconnectAccount(acct);
    return json({ ok: true });
  }
  return fail(404, 'Unknown endpoint');
}

async function handle(req: Request) {
  const { url, seg } = parts(req);
  if (seg[0]?.toLowerCase() === 'youtube') return youtube(req, seg[1], url);

  const code = String(seg[0] || '').toUpperCase();
  if (!CODE_RE.test(code)) return fail(404, 'Unknown match');

  // New recording: only the phone holding this match's current camera link
  if (seg.length === 1 && req.method === 'POST') {
    const b = await body(req);
    const key = String(b.k || '');
    if (!key || rooms.get(code)?.key !== key) return fail(403, 'Open the camera link from the CricScore app again');
    const target = b.target === 'youtube' ? 'youtube' : 'server';
    const acct = validAcct(b.acct) ? b.acct : null;
    if (target === 'youtube' && (!youtubeConfigured() || !acct || !getAccount(acct))) return fail(400, 'Connect a YouTube channel first');
    const mime = /^video\/(webm|mp4)/.test(String(b.mime)) ? String(b.mime) : 'video/webm';
    const r = createRecording({
      code, key, target, mime, ytAcct: acct,
      title: String(b.title || `CricScore match ${code}`).slice(0, 100),
      privacy: PRIVACY.includes(b.privacy) ? b.privacy : 'unlisted',
    });
    return json({ recording: publicView(r) });
  }

  if (seg.length === 1 && req.method === 'GET') {
    const list = liveTokenOk(code, url.searchParams.get('t'))
      ? listAllRecordings(code)
      : listRecordings(code, url.searchParams.get('k') || '');
    return json({ recordings: list.map(publicView) });
  }

  const r = seg[1] ? getRecording(code, seg[1]) : null;
  if (!r) return fail(404, 'Recording not found');
  const b = req.method === 'POST' ? await body(req) : {};
  const key = req.method === 'POST' ? String(b.k || '') : url.searchParams.get('k') || '';
  const camera = keyMatches(r, key);
  const scorer = liveTokenOk(code, req.method === 'POST' ? b.t : url.searchParams.get('t'));
  if (!camera && !scorer) return fail(403, 'Not allowed');
  const action = seg[2];

  if (!action && req.method === 'DELETE') {
    try {
      deleteRecording(r);
    } catch (e: any) {
      return fail(409, e.message);
    }
    return json({ ok: true });
  }

  // Only the camera phone records
  if (!camera && (req.method === 'PUT' || action === 'finish')) return fail(403, 'Not allowed');

  if (!action && req.method === 'PUT') {
    const offset = Number(url.searchParams.get('offset'));
    if (!Number.isInteger(offset) || offset < 0) return fail(400, 'Invalid offset');
    const data = Buffer.from(await req.arrayBuffer());
    if (!data.length || data.length > MAX_PIECE) return fail(413, 'Piece too large');
    const res = await appendPiece(r, offset, data);
    return json({ bytes: res.bytes }, res.ok ? 200 : 409);
  }

  if (action === 'finish' && req.method === 'POST') {
    return json({ recording: publicView(finishRecording(code, r.id, PRIVACY.includes(b.privacy) ? b.privacy : undefined)!) });
  }

  if (action === 'youtube' && req.method === 'POST') {
    if (!youtubeConfigured() || !validAcct(b.acct) || !getAccount(b.acct)) return fail(400, 'Connect a YouTube channel first');
    if (r.status === 'recording' || r.status === 'uploading') return fail(409, 'Wait until the recording is finished');
    if (!r.bytes) return fail(400, 'The recording is empty');
    startYouTubeUpload(r, b.acct, PRIVACY.includes(b.privacy) ? b.privacy : r.privacy);
    return json({ recording: publicView(getRecording(code, r.id)!) });
  }

  if (action === 'file' && (req.method === 'GET' || req.method === 'HEAD')) {
    const date = new Date(r.createdAt).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
    const file = fileStream(r);
    const headers: Record<string, string> = {
      'Content-Type': `video/${r.ext}`,
      'Accept-Ranges': 'bytes',
      'Content-Disposition': `${url.searchParams.get('inline') ? 'inline' : 'attachment'}; filename="CricScore-${code}-${date}.${r.ext}"`,
      'Cache-Control': 'no-store',
    };
    // Byte ranges, so a video player can jump to any ball
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') || '');
    if (m && (m[1] || m[2]) && file.size) {
      const start = m[1] ? Number(m[1]) : Math.max(0, file.size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), file.size - 1) : file.size - 1;
      if (start > end || start >= file.size) {
        return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${file.size}` } });
      }
      return new Response(req.method === 'HEAD' ? null : file.body(start, end), {
        status: 206,
        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${file.size}`, 'Content-Length': String(end - start + 1) },
      });
    }
    return new Response(req.method === 'HEAD' ? null : file.body(), {
      headers: { ...headers, 'Content-Length': String(file.size) },
    });
  }

  return fail(404, 'Unknown endpoint');
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
