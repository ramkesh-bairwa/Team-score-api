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

  // Seconds of video that a replay could show right now: footage actually held in the last
  // MAX_REPLAY_S (gaps, e.g. while the stream was paused or the page was reloaded, don't count)
  get available(): number {
    const now = Date.now();
    const from = now - MAX_REPLAY_S * 1000;
    let ms = this.recorder ? now - Math.max(from, this.recorderStart) : 0;
    for (const c of this.clips) if (c.end > from) ms += c.end - Math.max(from, c.start);
    return Math.min(MAX_REPLAY_S, Math.floor(ms / 1000));
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

  // The clips holding footage of the last `seconds` (up to what was filmed a moment ago), oldest
  // first. Only clips that overlap the window: a clip that ended before it (e.g. one restored from
  // before a page reload or a pause) is never included. Call release() when done with them.
  async take(seconds: number): Promise<{ clips: Clip[]; from: number }> {
    if (this.running) this.cut();
    await this.flushed;
    const from = Date.now() - seconds * 1000;
    const clips = this.clips.filter((c) => c.end > from);
    clips.forEach((c) => this.inUse.set(c.url, (this.inUse.get(c.url) ?? 0) + 1));
    return { clips, from };
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
    // The footage ends when stop() is called; onstop fires a little later
    const end = Date.now();
    const done = new Promise<void>((resolve) => {
      rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
      rec.onstop = () => {
        if (parts.length) {
          const blob = new Blob(parts, { type: rec.mimeType || 'video/webm' });
          const clip = { url: URL.createObjectURL(blob), blob, start, end };
          this.clips.push(clip);
          this.clips.sort((a, b) => a.start - b.start);
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
  ms: number; // how long this item plays (at rate 1), for the progress bar
  // Play only the last `tailMs` of the video (the start of the replay window falls inside it)
  tailMs?: number;
}

// Replay items for the window [from, now] out of buffered clips: the first clip is entered part
// way through so the replay starts exactly at `from`, not at the start of that clip.
export function planReplay(clips: Clip[], from: number): ReplayItem[] {
  return clips.map((c) => {
    const start = Math.max(from, c.start);
    return { url: c.url, ms: c.end - start, tailMs: start > c.start ? c.end - start : undefined };
  });
}

const PREPARE_TIMEOUT_MS = 6_000;
const STALL_MS = 4_000;

const once = (v: HTMLVideoElement, events: string[], ms: number) =>
  new Promise<string>((resolve) => {
    const done = (e: string) => {
      clearTimeout(t);
      events.forEach((name) => v.removeEventListener(name, handlers[name]));
      resolve(e);
    };
    const handlers: Record<string, () => void> = {};
    events.forEach((name) => {
      handlers[name] = () => done(name);
      v.addEventListener(name, handlers[name]);
    });
    const t = setTimeout(() => done('timeout'), ms);
  });

interface Slot {
  video: HTMLVideoElement;
  item: number; // index into items, -1 when empty
  ready: Promise<boolean>; // true once the first frame to show is decoded
  startAt: number; // seconds into the video where this item starts
}

// Plays videos back to back (buffered clips, or a ball clip from the server). Two <video>
// elements take turns: the next one is loaded, seeked and decoded while the current one plays,
// and the switch only happens once it has a frame, so the picture never goes black or jumps.
export class ReplayPlayer implements ReplaySource {
  private slots: Slot[];
  private active = 0;
  private index = 0;
  private doneMs = 0;
  private readonly totalMs: number;
  private finished = false;
  private switching = false;
  private lastTime = -1;
  private lastMove = Date.now();
  private watchdog: ReturnType<typeof setInterval>;
  // Resolves true when the first frame is ready and playback has begun (false if nothing played)
  readonly ready: Promise<boolean>;

  constructor(
    private items: ReplayItem[],
    readonly rate: number,
    private onEnd: () => void,
  ) {
    this.totalMs = items.reduce((n, c) => n + c.ms, 0) || 1;
    this.slots = [this.makeSlot(), this.makeSlot()];
    this.prepare(0, 0);
    this.prepare(1, 1);
    this.ready = this.begin();
    // Some browsers never fire `ended` for MediaRecorder WebM, and a broken clip can stall:
    // move on if the video on air stops advancing
    this.watchdog = setInterval(() => this.checkStall(), 500);
  }

  // The video on air, once it has a frame to draw (null until then)
  frame() {
    if (this.finished) return null;
    const v = this.slots[this.active].video;
    return v.readyState >= 2 && v.videoWidth ? v : null;
  }

  progress() {
    const s = this.slots[this.active];
    const cur = Number.isFinite(s.video.currentTime) ? Math.max(0, s.video.currentTime - s.startAt) * 1000 : 0;
    return Math.min(1, (this.doneMs + Math.min(cur, this.items[this.index]?.ms ?? cur)) / this.totalMs);
  }

  stop() {
    if (this.finished) return;
    this.finished = true;
    clearInterval(this.watchdog);
    for (const { video: v } of this.slots) {
      v.pause();
      v.removeAttribute('src');
      v.load();
      v.remove();
    }
    this.onEnd();
  }

  private makeSlot(): Slot {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    // Kept in the DOM (invisible) because some mobile browsers won't decode detached videos
    v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
    document.body.appendChild(v);
    v.onended = () => this.advance(v);
    return { video: v, item: -1, ready: Promise.resolve(false), startAt: 0 };
  }

  // Loads item `item` into a slot: metadata → (duration fix-up) → seek to the start → first frame
  private prepare(slotIdx: number, item: number) {
    const slot = this.slots[slotIdx];
    const v = slot.video;
    slot.item = item;
    slot.startAt = 0;
    if (item >= this.items.length) {
      v.removeAttribute('src');
      slot.ready = Promise.resolve(false);
      return;
    }
    const it = this.items[item];
    v.src = it.url;
    v.load(); // resets playbackRate, so the rate is set again in play()
    slot.ready = (async () => {
      if (v.readyState < 1 && (await once(v, ['loadedmetadata', 'error'], PREPARE_TIMEOUT_MS)) !== 'loadedmetadata') return false;
      if (slot.item !== item || this.finished) return false;
      let start = 0;
      if (it.tailMs != null) {
        // MediaRecorder WebM often has no duration until the end has been seen: seek far past
        // the end once, which makes the browser work it out
        if (!Number.isFinite(v.duration)) {
          v.currentTime = 1e9;
          await once(v, ['durationchange', 'seeked', 'error'], 3000);
        }
        if (Number.isFinite(v.duration) && v.duration > 0) start = Math.max(0, v.duration - it.tailMs / 1000);
      }
      if (start > 0.05 || v.currentTime !== 0) {
        v.currentTime = start;
        if (v.seeking) await once(v, ['seeked', 'error'], PREPARE_TIMEOUT_MS);
      }
      if (v.readyState < 2) await once(v, ['loadeddata', 'canplay', 'error'], PREPARE_TIMEOUT_MS);
      if (slot.item !== item) return false;
      slot.startAt = v.currentTime;
      return v.readyState >= 2;
    })();
  }

  private async begin(): Promise<boolean> {
    // Skip items that can't be played at all (e.g. a clip that failed to record)
    while (!this.finished && this.index < this.items.length) {
      if (await this.slots[this.active].ready) return this.play();
      if (this.finished) return false;
      if (!(await this.skipTo(this.index + 1))) return false;
    }
    if (!this.finished) this.stop();
    return false;
  }

  private play(): boolean {
    const v = this.slots[this.active].video;
    v.defaultPlaybackRate = this.rate;
    v.playbackRate = this.rate;
    this.lastTime = -1;
    this.lastMove = Date.now();
    v.play().catch(() => {
      if (!this.finished) void this.advance(v);
    });
    return true;
  }

  // Index `next` goes on air in the other slot (loaded there already when next = index + 1)
  private async skipTo(next: number): Promise<boolean> {
    if (next >= this.items.length) {
      this.stop();
      return false;
    }
    const prev = this.active;
    const other = 1 - prev;
    if (this.slots[other].item !== next) this.prepare(other, next);
    this.index = next;
    this.active = other;
    this.prepare(prev, next + 1);
    return true;
  }

  // The video on air finished (or failed/stalled): put the next one on air once it has a frame.
  // Until then the last frame of the current one stays on screen.
  private async advance(from: HTMLVideoElement) {
    if (this.finished || this.switching || from !== this.slots[this.active].video) return;
    this.switching = true;
    try {
      this.doneMs += this.items[this.index]?.ms ?? 0;
      let next = this.index + 1;
      const other = this.slots[1 - this.active];
      while (next < this.items.length) {
        if (other.item !== next) this.prepare(1 - this.active, next);
        if (await other.ready) break;
        if (this.finished) return;
        this.doneMs += this.items[next].ms;
        next++;
      }
      if (this.finished) return;
      if (next >= this.items.length) return this.stop();
      from.pause();
      const prev = this.active;
      this.active = 1 - prev;
      this.index = next;
      this.play();
      this.prepare(prev, next + 1);
    } finally {
      this.switching = false;
    }
  }

  private checkStall() {
    if (this.finished || this.switching) return;
    const v = this.slots[this.active].video;
    if (v.paused && this.lastTime < 0) return; // not started yet
    if (v.currentTime !== this.lastTime) {
      this.lastTime = v.currentTime;
      this.lastMove = Date.now();
      return;
    }
    if (Date.now() - this.lastMove > STALL_MS / Math.min(1, this.rate)) void this.advance(v);
  }
}
