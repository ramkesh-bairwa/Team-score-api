import { withBase } from './paths';

// Records the outgoing stream and uploads it to the server in small chunks while live,
// so long matches never have to fit in the phone's memory and nothing is lost if the tab closes.

const TIMESLICE_MS = 4000;
const CANDIDATE_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

export interface RecorderStatus {
  recording: boolean;
  paused: boolean;
  uploadedBytes: number;
  pendingChunks: number;
  error: string | null;
}

export const isRecordingSupported = () =>
  typeof MediaRecorder !== 'undefined' && CANDIDATE_TYPES.some((t) => MediaRecorder.isTypeSupported(t));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ChunkedRecorder {
  private recorder: MediaRecorder | null = null;
  private recordingId: number | null = null;
  private seq = 0;
  private queue: Promise<void> = Promise.resolve();
  private status: RecorderStatus = { recording: false, paused: false, uploadedBytes: 0, pendingChunks: 0, error: null };

  constructor(
    private roomId: string,
    private stream: MediaStream,
    private onStatus: (s: RecorderStatus) => void,
  ) {}

  get active() {
    return !!this.recorder && this.recorder.state !== 'inactive';
  }

  async start(): Promise<void> {
    const mimeType = CANDIDATE_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    if (!mimeType) throw new Error('This browser cannot record video');
    const res = await fetch(withBase(`/api/rooms/${this.roomId}/recordings`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mimeType }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not start recording');
    this.recordingId = data.recording.id;
    this.seq = 0;

    const recorder = new MediaRecorder(this.stream, { mimeType, videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 });
    recorder.ondataavailable = (e) => {
      if (e.data.size) this.enqueue(e.data);
    };
    recorder.onerror = () => this.update({ error: 'Recording stopped unexpectedly' });
    recorder.start(TIMESLICE_MS);
    this.recorder = recorder;
    this.update({ recording: true, paused: false, error: null });
  }

  pause() {
    if (this.recorder?.state === 'recording') {
      this.recorder.requestData();
      this.recorder.pause();
      this.update({ paused: true });
    }
  }

  resume() {
    if (this.recorder?.state === 'paused') {
      this.recorder.resume();
      this.update({ paused: false });
    }
  }

  // Flushes the last chunk, waits for every upload, then closes the segment on the server
  async stop(): Promise<void> {
    const recorder = this.recorder;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
        recorder.stop();
      });
    }
    this.recorder = null;
    await this.queue;
    if (this.recordingId) {
      await fetch(withBase(`/api/recordings/${this.recordingId}/finish`), { method: 'POST' }).catch(() => {});
    }
    this.update({ recording: false, paused: false });
  }

  private enqueue(blob: Blob) {
    const seq = this.seq++;
    const id = this.recordingId;
    this.update({ pendingChunks: this.status.pendingChunks + 1 });
    this.queue = this.queue.then(async () => {
      try {
        await this.upload(id!, seq, blob);
        this.update({ uploadedBytes: this.status.uploadedBytes + blob.size, error: null });
      } catch (err) {
        this.update({ error: (err as Error).message });
      } finally {
        this.update({ pendingChunks: this.status.pendingChunks - 1 });
      }
    });
  }

  // Retries with backoff; a network blip at the ground shouldn't lose the recording
  private async upload(id: number, seq: number, blob: Blob) {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(withBase(`/api/recordings/${id}/chunks?seq=${seq}`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: blob,
        });
        if (res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (res.status >= 400 && res.status < 500) throw Object.assign(new Error(data.error || 'Upload rejected'), { fatal: true });
      } catch (err) {
        if ((err as { fatal?: boolean }).fatal || attempt >= 20) throw err;
      }
      await sleep(Math.min(15000, 1000 * 2 ** Math.min(attempt, 4)));
    }
  }

  private update(patch: Partial<RecorderStatus>) {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.status);
  }
}
