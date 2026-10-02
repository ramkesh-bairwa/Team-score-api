import type { ReplaySource } from './compositor';

// Keeps the last minute or so of camera video in memory so the streamer can put a replay on air.
// The buffer is a ring of short clips, each from its own MediaRecorder run: a WebM fragment cut
// from the middle of one long recording has no header and can't be played on its own.
// Only the clean camera picture is buffered; the compositor draws the live scoreboard over the
// replay, so the score stays current while the replay runs.

const CLIP_MS = 8_000;
const KEEP_MS = 75_000;
const TYPES = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

interface Clip {
  url: string;
  start: number;
  end: number;
}

export const isReplaySupported = () =>
  typeof MediaRecorder !== 'undefined' && TYPES.some((t) => MediaRecorder.isTypeSupported(t));

export class ReplayBuffer {
  private clips: Clip[] = [];
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private recorderStart = 0;
  private flushed: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private inUse = new Set<string>();

  // Seconds of video that a replay could show right now
  get available(): number {
    const first = this.clips[0]?.start ?? (this.recorder ? this.recorderStart : 0);
    return first ? Math.floor((Date.now() - first) / 1000) : 0;
  }

  start(stream: MediaStream) {
    this.stream = stream;
    this.running = true;
    this.cut();
  }

  // The camera track changed (flip): keep the clips, record the new track from now on
  setStream(stream: MediaStream) {
    this.stream = stream;
    if (this.running) this.cut();
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.recorder?.state !== 'inactive') this.recorder?.stop();
    this.recorder = null;
    this.clips.forEach((c) => this.inUse.has(c.url) || URL.revokeObjectURL(c.url));
    this.clips = [];
  }

  // Clips covering at least the last `seconds`, including what was filmed a moment ago
  async take(seconds: number): Promise<Clip[]> {
    this.cut();
    await this.flushed;
    const from = Date.now() - seconds * 1000;
    const out: Clip[] = [];
    for (let i = this.clips.length - 1; i >= 0; i--) {
      out.unshift(this.clips[i]);
      if (this.clips[i].start <= from) break;
    }
    out.forEach((c) => this.inUse.add(c.url));
    return out;
  }

  release(clips: Clip[]) {
    for (const c of clips) {
      this.inUse.delete(c.url);
      if (!this.clips.includes(c)) URL.revokeObjectURL(c.url);
    }
  }

  // Close the current clip and immediately start the next (the new recorder starts first,
  // so there's no gap between clips)
  private cut() {
    if (this.timer) clearTimeout(this.timer);
    const prev = this.recorder;
    const prevStart = this.recorderStart;
    this.recorder = null;
    if (this.running && this.stream?.getVideoTracks().some((t) => t.readyState === 'live')) {
      const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
      try {
        const rec = new MediaRecorder(this.stream, { mimeType, videoBitsPerSecond: 1_500_000 });
        rec.start();
        this.recorder = rec;
        this.recorderStart = Date.now();
      } catch {
        // camera gone; try again on the next cut
      }
      this.timer = setTimeout(() => this.cut(), CLIP_MS);
    }
    if (prev && prev.state !== 'inactive') {
      const parts: Blob[] = [];
      this.flushed = new Promise<void>((resolve) => {
        prev.ondataavailable = (e) => e.data.size && parts.push(e.data);
        prev.onstop = () => {
          if (parts.length) {
            const blob = new Blob(parts, { type: prev.mimeType || 'video/webm' });
            this.clips.push({ url: URL.createObjectURL(blob), start: prevStart, end: Date.now() });
            this.prune();
          }
          resolve();
        };
        prev.stop();
      });
    }
  }

  private prune() {
    const cutoff = Date.now() - KEEP_MS;
    while (this.clips.length && this.clips[0].end < cutoff) {
      const c = this.clips.shift()!;
      if (!this.inUse.has(c.url)) URL.revokeObjectURL(c.url);
    }
  }
}

// Plays buffered clips back to back. Two <video> elements take turns so the next clip is
// already loaded when the current one ends.
export class ReplayPlayer implements ReplaySource {
  private videos: HTMLVideoElement[];
  private index = 0;
  private active = 0;
  private doneMs = 0;
  private readonly totalMs: number;
  private finished = false;

  constructor(
    private clips: Clip[],
    readonly rate: number,
    private onEnd: () => void,
  ) {
    this.totalMs = clips.reduce((n, c) => n + (c.end - c.start), 0) || 1;
    this.videos = [this.makeVideo(), this.makeVideo()];
    this.load(0, 0);
    this.load(1, 1);
    this.play();
  }

  frame() {
    return this.videos[this.active];
  }

  progress() {
    const v = this.videos[this.active];
    const cur = Number.isFinite(v.currentTime) ? v.currentTime * 1000 : 0;
    return Math.min(1, (this.doneMs + cur) / this.totalMs);
  }

  stop() {
    if (this.finished) return;
    this.finished = true;
    for (const v of this.videos) {
      v.pause();
      v.removeAttribute('src');
      v.load();
      v.remove();
    }
    this.onEnd();
  }

  private makeVideo() {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    // Kept in the DOM (invisible) because some mobile browsers won't decode detached videos
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.appendChild(v);
    v.onended = () => this.next(v);
    v.onerror = () => this.next(v);
    return v;
  }

  private load(slot: number, clip: number) {
    const v = this.videos[slot];
    if (clip >= this.clips.length) return v.removeAttribute('src');
    v.src = this.clips[clip].url;
    v.load();
  }

  private play() {
    const v = this.videos[this.active];
    v.playbackRate = this.rate;
    v.play().catch(() => this.next(v));
  }

  // Only the clip on air advances the replay; an error while preloading the other one is
  // handled when it gets its turn
  private next(from: HTMLVideoElement) {
    if (this.finished || from !== this.videos[this.active]) return;
    const c = this.clips[this.index];
    if (c) this.doneMs += c.end - c.start;
    this.index++;
    if (this.index >= this.clips.length) return this.stop();
    const prevSlot = this.active;
    this.active = 1 - this.active;
    this.play();
    this.load(prevSlot, this.index + 1);
  }
}
