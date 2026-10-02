import { withBase } from './paths';

// Every recorded chunk is written to this device (IndexedDB) before anything goes over the network.
// Uploading happens only when there is a connection, so a ground with no internet still ends up
// with the full match on the phone; it can be sent to the server (and from there to YouTube) later.
// If IndexedDB isn't available (some private modes) chunks are held in memory for this page only.

export interface LocalRecording {
  localId: string;
  roomId: string;
  title: string;
  mimeType: string;
  serverId: number | null;
  createdAt: number;
  updatedAt: number;
  savedChunks: number;
  savedBytes: number;
  uploadedChunks: number;
  uploadedBytes: number;
  // The recorder has stopped; once everything is uploaded the server copy can be closed
  closed: boolean;
}

// serverId: the server copy, once one exists (null if there was nothing to upload)
export type UploadResult = { status: 'done'; serverId: number | null } | { status: 'offline' };

const DB_NAME = 'cricscore-local-recordings';
const RECS = 'recordings';
const CHUNKS = 'chunks';
const CHUNK_TIMEOUT_MS = 60_000;

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memRecs = new Map<string, LocalRecording>();
const memChunks = new Map<string, Blob>();
const memKey = (localId: string, seq: number) => `${localId}:${seq}`;

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(RECS)) db.createObjectStore(RECS, { keyPath: 'localId' });
        if (!db.objectStoreNames.contains(CHUNKS)) db.createObjectStore(CHUNKS, { keyPath: ['localId', 'seq'] });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function run<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result as T);
    tx.onerror = () => reject(tx.error ?? req.error);
    tx.onabort = () => reject(tx.error ?? new Error('Storage write was aborted'));
  });
}

// Ask the browser not to evict our data when the device runs low on space
export function requestPersistentStorage() {
  navigator.storage?.persist?.().catch(() => {});
}

export const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export async function createLocal(init: Pick<LocalRecording, 'roomId' | 'title' | 'mimeType'>): Promise<LocalRecording> {
  const now = Date.now();
  const rec: LocalRecording = {
    ...init,
    localId: newId(),
    serverId: null,
    createdAt: now,
    updatedAt: now,
    savedChunks: 0,
    savedBytes: 0,
    uploadedChunks: 0,
    uploadedBytes: 0,
    closed: false,
  };
  await putRec(rec);
  return rec;
}

async function putRec(rec: LocalRecording) {
  const db = await openDb();
  if (db && !memRecs.has(rec.localId)) {
    try {
      await run(db, RECS, 'readwrite', (s) => s.put(rec));
      return;
    } catch {}
  }
  memRecs.set(rec.localId, rec);
}

export async function getLocal(localId: string): Promise<LocalRecording | null> {
  if (memRecs.has(localId)) return memRecs.get(localId)!;
  const db = await openDb();
  if (!db) return null;
  return (await run<LocalRecording | undefined>(db, RECS, 'readonly', (s) => s.get(localId))) ?? null;
}

export async function listLocal(roomId?: string): Promise<LocalRecording[]> {
  const db = await openDb();
  const stored = db ? await run<LocalRecording[]>(db, RECS, 'readonly', (s) => s.getAll()).catch(() => []) : [];
  const all = [...stored.filter((r) => !memRecs.has(r.localId)), ...memRecs.values()];
  return all.filter((r) => !roomId || r.roomId === roomId).sort((a, b) => b.createdAt - a.createdAt);
}

// Writes to the same recording are serialized so read-modify-write updates can't interleave
const recLocks = new Map<string, Promise<unknown>>();
export function updateLocal(localId: string, patch: (r: LocalRecording) => Partial<LocalRecording>): Promise<LocalRecording | null> {
  const prev = recLocks.get(localId) ?? Promise.resolve();
  const next = prev.then(async () => {
    const rec = await getLocal(localId);
    if (!rec) return null;
    const updated = { ...rec, ...patch(rec), updatedAt: Date.now() };
    await putRec(updated);
    return updated;
  });
  recLocks.set(localId, next.catch(() => {}));
  return next;
}

export async function putChunk(localId: string, seq: number, blob: Blob): Promise<void> {
  const db = await openDb();
  if (db) {
    try {
      await run(db, CHUNKS, 'readwrite', (s) => s.put({ localId, seq, blob }));
      return;
    } catch {
      // Storage full or blocked: keep it in memory so the upload can still pick it up
    }
  }
  memChunks.set(memKey(localId, seq), blob);
}

async function getChunk(localId: string, seq: number): Promise<Blob | null> {
  const mem = memChunks.get(memKey(localId, seq));
  if (mem) return mem;
  const db = await openDb();
  if (!db) return null;
  const row = await run<{ blob: Blob } | undefined>(db, CHUNKS, 'readonly', (s) => s.get([localId, seq]));
  return row?.blob ?? null;
}

async function deleteChunk(localId: string, seq: number) {
  memChunks.delete(memKey(localId, seq));
  const db = await openDb();
  if (db) await run(db, CHUNKS, 'readwrite', (s) => s.delete([localId, seq])).catch(() => {});
}

export async function deleteLocal(localId: string): Promise<void> {
  for (const key of memChunks.keys()) if (key.startsWith(`${localId}:`)) memChunks.delete(key);
  memRecs.delete(localId);
  const db = await openDb();
  if (!db) return;
  await run(db, CHUNKS, 'readwrite', (s) =>
    s.delete(IDBKeyRange.bound([localId, 0], [localId, Number.MAX_SAFE_INTEGER])),
  ).catch(() => {});
  await run(db, RECS, 'readwrite', (s) => s.delete(localId)).catch(() => {});
}

// The whole video as one file, for saving to the phone. Only possible while no chunk has been
// uploaded yet: uploaded chunks are removed from the device to free space.
export async function assembleFile(localId: string): Promise<Blob | null> {
  const rec = await getLocal(localId);
  if (!rec || rec.uploadedChunks > 0) return null;
  const parts: Blob[] = [];
  for (let seq = 0; seq < rec.savedChunks; seq++) {
    const blob = await getChunk(localId, seq);
    if (!blob) return null;
    parts.push(blob);
  }
  return new Blob(parts, { type: rec.mimeType });
}

class FatalUploadError extends Error {}

const timeoutSignal = () =>
  typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal ? AbortSignal.timeout(CHUNK_TIMEOUT_MS) : undefined;

// fetch that reports a lost connection as null instead of throwing
async function tryFetch(url: string, init: RequestInit): Promise<Response | null> {
  try {
    return await fetch(withBase(url), { ...init, signal: timeoutSignal() });
  } catch {
    return null;
  }
}

async function ensureServerRecording(rec: LocalRecording): Promise<LocalRecording | null> {
  if (rec.serverId != null) return rec;
  // late: the room may already have ended while this device was offline
  const res = await tryFetch(`/api/rooms/${rec.roomId}/recordings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mimeType: rec.mimeType, late: true }),
  });
  if (!res) return null;
  const data = await res.json().catch(() => ({}));
  if (res.status >= 500) return null;
  if (!res.ok) throw new FatalUploadError(data.error || 'The server would not accept this recording');
  return updateLocal(rec.localId, () => ({ serverId: data.recording.id }));
}

const inFlight = new Map<string, Promise<UploadResult>>();

/**
 * Sends every chunk saved on this device that the server doesn't have yet, in order, and closes the
 * server copy once the recorder has stopped. Resolves 'offline' when the connection drops (try
 * again later; nothing is lost) and rejects only when the server refuses the recording.
 * Concurrent calls for the same recording share one run.
 */
export function uploadLocal(
  localId: string,
  opts: { close?: boolean; onProgress?: (r: LocalRecording) => void } = {},
): Promise<UploadResult> {
  const existing = inFlight.get(localId);
  if (existing) return existing;
  const p = doUpload(localId, opts).finally(() => inFlight.delete(localId));
  inFlight.set(localId, p);
  return p;
}

const OFFLINE: UploadResult = { status: 'offline' };

async function doUpload(
  localId: string,
  { close, onProgress }: { close?: boolean; onProgress?: (r: LocalRecording) => void },
): Promise<UploadResult> {
  let rec = await getLocal(localId);
  if (!rec) return { status: 'done', serverId: null };
  if (close && !rec.closed) rec = (await updateLocal(localId, () => ({ closed: true })))!;
  if (rec.closed && rec.savedChunks === 0 && rec.serverId == null) {
    await deleteLocal(localId);
    return { status: 'done', serverId: null };
  }
  if (!isOnline()) return OFFLINE;
  rec = await ensureServerRecording(rec);
  if (!rec) return OFFLINE;
  const serverId = rec.serverId!;

  while (rec.uploadedChunks < rec.savedChunks) {
    if (!isOnline()) return OFFLINE;
    const seq = rec.uploadedChunks;
    const blob = await getChunk(localId, seq);
    if (!blob) throw new FatalUploadError('Part of this recording is missing from the device');
    const res = await tryFetch(`/api/recordings/${serverId}/chunks?seq=${seq}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: blob,
    });
    if (!res || res.status >= 500) return OFFLINE;
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      // The server already has this piece (its earlier response was lost); anything else is fatal
      if (!(res.status === 409 && typeof data.next === 'number' && data.next > seq)) {
        throw new FatalUploadError(data.error || 'The server rejected the recording');
      }
    }
    await deleteChunk(localId, seq);
    rec = (await updateLocal(localId, (r) => ({ uploadedChunks: r.uploadedChunks + 1, uploadedBytes: r.uploadedBytes + blob.size })))!;
    onProgress?.(rec);
  }

  if (rec.closed) {
    const res = await tryFetch(`/api/recordings/${serverId}/finish`, { method: 'POST' });
    if (!res || res.status >= 500) return OFFLINE;
    // Fully on the server now; it takes over from here (download, full match video, YouTube)
    await deleteLocal(localId);
  }
  return { status: 'done', serverId };
}

export const isFatalUploadError = (err: unknown) => err instanceof FatalUploadError;
