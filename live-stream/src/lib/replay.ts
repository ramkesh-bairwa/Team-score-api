import { loadClips, pruneClips, saveClip } from './clip-store';
import type { ReplaySource } from './compositor';

// Keeps the last few minutes of camera video so the streamer can put a replay on air.
// The buffer is a ring of short clips, each from its own MediaRecorder run: a WebM fragment cut
// from the middle of one long recording has no header and can't be played on its own.
// Clips are also saved to IndexedDB, so refreshing the studio page keeps the buffer.
// Only the clean camera picture is buffered; the compositor draws the live scoreboard over the
// replay, so the score stays current while the replay runs.

const CLIP_MS = 8_000;
export const MAX_REPLAY_S = 180;
const KEEP_MS = (MAX_REPLAY_S + 20) * 1000;
const TYPES = ['video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

export interface Clip {
  url: string;
  blob: Blob;
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
  private inUse = new Map<string, number>();

  constructor(private roomId: string) {}

  // Seconds of video that a replay could show right now
  get available(): number {
    const first = this.clips[0]?.start ?? (this.recorder ? this.recorderStart : 0);
    return first ? Math.min(MAX_REPLAY_S, Math.floor((Date.now() - first) / 1000)) : 0;
  }

  async start(stream: MediaStream) {
    this.stream = stream;
    this.running = true;
    this.cut();
    // Bring back what was filmed before a page refresh
    const saved = await loadClips(this.roomId, Date.now() - KEEP_MS);
    const have = new Set(this.clips.map((c) => c.start));
    const restored = saved
      .filter((c) => !have.has(c.start))
      .map((c) => ({ url: URL.createObjectURL(c.blob), blob: c.blob, start: c.start, end: c.end }));
    this.clips = [...restored, ...this.clips].sort((a, b) => a.start - b.start);
    void pruneClips(Date.now() - KEEP_MS);
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
    const rec = this.recorder;
    this.recorder = null;
    // Save the clip in progress too, so a refresh right after pausing keeps it
    if (rec && rec.state !== 'inactive') this.finish(rec, this.recorderStart);
    void this.flushed.then(() => {
      this.clips.forEach((c) => this.inUse.has(c.url) || URL.revokeObjectURL(c.url));
      this.clips = [];
    });
  }

  // Clips covering at least the last `seconds`, including what was filmed a moment ago.
  // Call release() when done with them.
  async take(seconds: number): Promise<Clip[]> {
    if (this.running) this.cut();
    await this.flushed;
    const from = Date.now() - seconds * 1000;
    const out: Clip[] = [];
    for (let i = this.clips.length - 1; i >= 0; i--) {
      out.unshift(this.clips[i]);
      if (this.clips[i].start <= from) break;
    }
    out.forEach((c) => this.inUse.set(c.url, (this.inUse.get(c.url) ?? 0) + 1));
    return out;
  }

  release(clips: Clip[]) {
    for (const c of clips) {
      const n = (this.inUse.get(c.url) ?? 1) - 1;
      if (n > 0) this.inUse.set(c.url, n);
      else {
        this.inUse.delete(c.url);
        if (!this.clips.includes(c)) URL.revokeObjectURL(c.url);
      }
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
        const rec = new MediaRecorder(this.stream, { mimeType, videoBitsPerSecond: 1_000_000 });
        rec.start();
        this.recorder = rec;
        this.recorderStart = Date.now();
      } catch {
        // camera gone; try again on the next cut
      }
      this.timer = setTimeout(() => this.cut(), CLIP_MS);
    }
    if (prev && prev.state !== 'inactive') this.finish(prev, prevStart);
  }

  private finish(rec: MediaRecorder, start: number) {
    const parts: Blob[] = [];
    const done = new Promise<void>((resolve) => {
      rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
      rec.onstop = () => {
        if (parts.length) {
          const blob = new Blob(parts, { type: rec.mimeType || 'video/webm' });
          const clip = { url: URL.createObjectURL(blob), blob, start, end: Date.now() };
          this.clips.push(clip);
          void saveClip({ roomId: this.roomId, start: clip.start, end: clip.end, blob });
          this.prune();
        }
        resolve();
      };
      rec.stop();
    });
    this.flushed = Promise.all([this.flushed, done]).then(() => {});
  }

  private prune() {
    const cutoff = Date.now() - KEEP_MS;
    while (this.clips.length && this.clips[0].end < cutoff) {
      const c = this.clips.shift()!;
      if (!this.inUse.has(c.url)) URL.revokeObjectURL(c.url);
    }
    void pruneClips(cutoff);
  }
}

export interface ReplayItem {
  url: string;
  ms: number; // expected length, for the progress bar
}

// Plays videos back to back (buffered clips, or a ball clip from the server). Two <video>
// elements take turns so the next one is already loaded when the current one ends.
export class ReplayPlayer implements ReplaySource {
  private videos: HTMLVideoElement[];
  private index = 0;
  private active = 0;
  private doneMs = 0;
  private readonly totalMs: number;
  private finished = false;

  constructor(
    private items: ReplayItem[],
    readonly rate: number,
    private onEnd: () => void,
  ) {
    this.totalMs = items.reduce((n, c) => n + c.ms, 0) || 1;
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

  private load(slot: number, item: number) {
    const v = this.videos[slot];
    if (item >= this.items.length) return v.removeAttribute('src');
    v.src = this.items[item].url;
    v.load();
  }

  private play() {
    const v = this.videos[this.active];
    v.playbackRate = this.rate;
    v.play().catch(() => this.next(v));
  }

  // Only the video on air advances the replay; an error while preloading the other one is
  // handled when it gets its turn
  private next(from: HTMLVideoElement) {
    if (this.finished || from !== this.videos[this.active]) return;
    this.doneMs += this.items[this.index]?.ms ?? 0;
    this.index++;
    if (this.index >= this.items.length) return this.stop();
    const prevSlot = this.active;
    this.active = 1 - this.active;
    this.play();
    this.load(prevSlot, this.index + 1);
  }
}
