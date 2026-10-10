// YouTube Live straight from the camera phone (/go/:code). Browsers can't speak RTMP, so the phone
// records what it shows (camera + scoreboard) in 1-second WebM pieces and sends them over the
// signaling socket; ffmpeg turns them into H.264/AAC and pushes them to YouTube with the channel's
// stream key. Only a stream key is needed (YouTube Studio → Go live → Stream), no Google sign-in.
// YouTube saves the live stream as a video on the channel when it ends.
import { spawn, type ChildProcess } from 'child_process';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const RTMP = (process.env.YOUTUBE_RTMP_URL || 'rtmp://a.rtmp.youtube.com/live2').replace(/\/$/, '');
const KEY_RE = /^[A-Za-z0-9_-]{4,80}$/;
// More than this waiting for ffmpeg means the server's upload to YouTube can't keep up
const MAX_BACKLOG = 32 * 1024 * 1024;
// ffmpeg still running this long after start = YouTube took the stream
const LIVE_AFTER_MS = 8000;

// Only a found ffmpeg is remembered, so installing it later works without a restart
let found = false;
export function hasFfmpeg(): Promise<boolean> {
  if (found) return Promise.resolve(true);
  return new Promise(resolve => {
    const p = spawn(FFMPEG, ['-version'], { stdio: 'ignore' });
    p.on('error', () => resolve(false));
    p.on('close', code => resolve((found = code === 0)));
  });
}

// One fixed 1280×720 output whatever the phone sends (it changes size when the phone turns)
const args = (key: string) => [
  '-hide_banner', '-loglevel', 'error',
  '-i', 'pipe:0',
  '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30',
  '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-pix_fmt', 'yuv420p',
  '-b:v', '2500k', '-maxrate', '2500k', '-bufsize', '5000k', '-g', '60', '-keyint_min', '60',
  '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
  '-f', 'flv', `${RTMP}/${key}`,
];

const explain = (log: string) => {
  if (/Broken pipe|Input\/output error|Connection reset|403|404|Server returned/i.test(log)) {
    return 'YouTube refused the stream. Check the stream key, and that live streaming is turned on for the channel (the first time it can take up to 24 hours).';
  }
  if (/Connection refused|timed out|unreachable|resolve/i.test(log)) return 'The server could not reach YouTube. Try again in a moment.';
  const last = log.trim().split('\n').pop();
  return last ? `YouTube stream stopped: ${last.slice(0, 200)}` : 'YouTube stream stopped.';
};

type Joined = { code: string; role: string } | null;

// Adds the yt-start / yt-data / yt-stop events to a camera phone's socket
export function attachYouTubeLive(socket: any, joined: () => Joined) {
  let ff: ChildProcess | null = null;
  let liveTimer: ReturnType<typeof setTimeout> | null = null;
  const status = (state: string, error: string | null = null) => socket.emit('yt-status', { state, error });

  const stop = () => {
    const p = ff;
    ff = null;
    if (liveTimer) clearTimeout(liveTimer);
    if (!p) return;
    try { p.stdin?.end(); } catch {}
    setTimeout(() => p.kill('SIGKILL'), 5000).unref();
  };

  socket.on('yt-start', async ({ key }: { key?: string } = {}) => {
    if (joined()?.role !== 'broadcaster') return;
    if (typeof key !== 'string' || !KEY_RE.test(key)) {
      return status('error', 'That stream key doesn’t look right. Copy it again from YouTube Studio.');
    }
    if (!(await hasFfmpeg())) return status('error', 'YouTube Live needs ffmpeg on the server. Ask the admin to run: apt-get install -y ffmpeg');
    stop();
    let log = '';
    const p = spawn(FFMPEG, args(key), { stdio: ['pipe', 'ignore', 'pipe'] });
    ff = p;
    status('starting');
    p.stderr!.on('data', d => { log = (log + d).slice(-4000); });
    p.stdin!.on('error', () => {});
    p.on('error', () => { if (ff === p) { ff = null; status('error', 'Could not start ffmpeg on the server.'); } });
    p.on('close', code => {
      if (ff !== p) return; // stopped on purpose
      ff = null;
      if (liveTimer) clearTimeout(liveTimer);
      if (code) console.error('[yt-live]', joined()?.code, log.trim().split('\n').slice(-3).join(' | '));
      status(code ? 'error' : 'stopped', code ? explain(log) : null);
    });
    liveTimer = setTimeout(() => { if (ff === p) status('live'); }, LIVE_AFTER_MS);
  });

  socket.on('yt-data', (buf: ArrayBuffer | Buffer) => {
    const p = ff;
    if (!p || !p.stdin || !buf) return;
    if (p.stdin.writableLength > MAX_BACKLOG) {
      stop();
      return status('error', 'The connection from the server to YouTube is too slow. The YouTube stream stopped.');
    }
    p.stdin.write(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  });

  socket.on('yt-stop', () => {
    if (!ff) return;
    stop();
    status('stopped');
  });

  socket.on('disconnect', stop);
}
