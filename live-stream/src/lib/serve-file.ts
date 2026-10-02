import { createReadStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { jsonError } from './http';

// Streams a video file, honouring Range requests so players can seek
export function serveVideo(req: Request, file: string, mime: string): Response {
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    return jsonError('Video file is missing', 404);
  }
  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '');
  if (range && (range[1] || range[2])) {
    const start = Math.max(0, range[1] ? Number(range[1]) : size - Number(range[2]));
    const end = Math.min(range[1] && range[2] ? Number(range[2]) : size - 1, size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
      status: 206,
      headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: { ...headers, 'Content-Length': String(size) },
  });
}
