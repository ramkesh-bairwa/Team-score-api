import {
  createLocal,
  isFatalUploadError,
  isOnline,
  putChunk,
  requestPersistentStorage,
  updateLocal,
  uploadLocal,
  type LocalRecording,
} from './local-recordings';
import { withBase } from './paths';

// Records the outgoing stream in small chunks. Each chunk is saved on this device first and then
// uploaded while there is internet, so long matches never have to fit in the phone's memory and
// nothing is lost if the connection drops or the tab closes. Whatever couldn't be uploaded stays
// on the device and can be sent after the match (see LocalRecordingsPanel).

const TIMESLICE_MS = 4000;
// After the match, wait this long for the last pieces before showing the end screen; the rest
// keep uploading in the background, or wait on the device if the connection is gone
const STOP_WAIT_MS = 30_000;
const SERVER_RETRY_MS = 5000;
const CANDIDATE_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];

export interface RecorderStatus {
  recording: boolean;
  paused: boolean;
  online: boolean;
  savedBytes: number;
  uploadedBytes: number;
  pendingChunks: number;
  error: string | null;
}

export const isRecordingSupported = () =>
  typeof MediaRecorder !== 'undefined' && CANDIDATE_TYPES.some((t) => MediaRecorder.isTypeSupported(t));

export class ChunkedRecorder {
  private recorder: MediaRecorder | null = null;
  private localId: string | null = null;
  private seq = 0;
  private saving: Promise<void> = Promise.resolve();
  private syncing: Promise<void> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private status: RecorderStatus = {
    recording: false,
    paused: false,
    online: isOnline(),
    savedBytes: 0,
    uploadedBytes: 0,
    pendingChunks: 0,
    error: null,
  };

  constructor(
    private roomId: string,
    private title: string,
    private stream: MediaStream,
    private onStatus: (s: RecorderStatus) => void,
  ) {}

  get active() {
    return !!this.recorder && this.recorder.state !== 'inactive';
  }

  async start(): Promise<void> {
    const mimeType = CANDIDATE_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    if (!mimeType) throw new Error('This browser cannot record video');
    requestPersistentStorage();
    const local = await createLocal({ roomId: this.roomId, title: this.title, mimeType: mimeType.split(';')[0] });
    this.localId = local.localId;
    this.seq = 0;
    await this.createOnServer(mimeType);

    const recorder = new MediaRecorder(this.stream, { mimeType, videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 });
    recorder.ondataavailable = (e) => {
      if (e.data.size) this.save(e.data);
    };
    recorder.onerror = () => this.update({ error: 'Recording stopped unexpectedly' });
    recorder.start(TIMESLICE_MS);
    this.recorder = recorder;
    window.addEventListener('online', this.onOnline);
    window.addEventListener('offline', this.onOffline);
    this.update({ recording: true, paused: false, online: isOnline(), error: null });
  }

  // Claim the server segment up front when we can, so its part number follows recording order.
  // With no connection the device copy is enough; the segment is created when the upload starts.
  private async createOnServer(mimeType: string) {
    if (!isOnline()) return;
    let res: Response;
    try {
      res = await fetch(withBase(`/api/rooms/${this.roomId}/recordings`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mimeType }),
      });
    } catch {
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (res.status >= 500) return;
    if (!res.ok) throw new Error(data.error || 'Could not start recording');
    await updateLocal(this.localId!, () => ({ serverId: data.recording.id }));
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

  // Flushes the last chunk to the device, then gives the upload a short while to catch up
  async stop(): Promise<void> {
    const recorder = this.recorder;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => {
        recorder.addEventListener('stop', () => resolve(), { once: true });
        recorder.stop();
      });
    }
    this.recorder = null;
    this.stopped = true;
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('offline', this.onOffline);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    await this.saving;
    if (this.localId) {
      await updateLocal(this.localId, () => ({ closed: true }));
      if (isOnline()) {
        // A run started while recording won't close the server copy; start the final one after it
        const final = (this.syncing ?? Promise.resolve()).then(() => this.sync());
        await Promise.race([final, new Promise((r) => setTimeout(r, STOP_WAIT_MS))]);
      }
    }
    this.update({ recording: false, paused: false });
  }

  private onOnline = () => {
    this.update({ online: true });
    this.kick();
  };

  private onOffline = () => this.update({ online: false });

  private save(blob: Blob) {
    const seq = this.seq++;
    const localId = this.localId!;
    this.saving = this.saving
      .then(async () => {
        await putChunk(localId, seq, blob);
        const rec = await updateLocal(localId, (r) => ({ savedChunks: seq + 1, savedBytes: r.savedBytes + blob.size }));
        if (rec) this.progress(rec);
      })
      .catch(() => this.update({ error: 'Could not save the recording on this device' }))
      .then(() => this.kick());
  }

  private kick() {
    if (this.stopped || this.syncing || !this.localId || !isOnline()) return;
    this.syncing = this.sync().finally(() => (this.syncing = null));
  }

  private async sync(): Promise<void> {
    try {
      const result = await uploadLocal(this.localId!, { onProgress: (r) => this.progress(r) });
      if (result.status === 'offline' && !this.stopped) {
        // A server hiccup with the network up: try again shortly. A real outage waits for 'online'.
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => this.kick(), SERVER_RETRY_MS);
      } else if (result.status === 'done' && this.status.error) {
        this.update({ error: null });
      }
    } catch (err) {
      this.update({
        error: isFatalUploadError(err)
          ? `${(err as Error).message}. The video is still saved on this device.`
          : (err as Error).message,
      });
    }
  }

  private progress(rec: LocalRecording) {
    this.update({
      savedBytes: rec.savedBytes,
      uploadedBytes: rec.uploadedBytes,
      pendingChunks: rec.savedChunks - rec.uploadedChunks,
    });
  }

  private update(patch: Partial<RecorderStatus>) {
    this.status = { ...this.status, ...patch };
    this.onStatus(this.status);
  }
}
