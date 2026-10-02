// Replay clips kept in the browser's IndexedDB, so a page refresh (or a crash and reopen) on the
// camera device doesn't lose the last few minutes of video. Everything here is best-effort: if
// storage is unavailable (private mode, quota) replays still work from memory.

const DB_NAME = 'cricscore-replay';
const STORE = 'clips';

export interface StoredClip {
  key: string; // `${roomId}:${start}`
  roomId: string;
  start: number;
  end: number;
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        t.oncomplete = () => resolve(req ? req.result : undefined);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

export async function saveClip(c: Omit<StoredClip, 'key'>): Promise<void> {
  await tx('readwrite', (s) => s.put({ ...c, key: `${c.roomId}:${c.start}` })).catch(() => {});
}

// Clips of this room that ended after `since`, oldest first
export async function loadClips(roomId: string, since: number): Promise<StoredClip[]> {
  const all = (await tx<StoredClip[]>('readonly', (s) => s.getAll()).catch(() => [])) ?? [];
  return all.filter((c) => c.roomId === roomId && c.end > since).sort((a, b) => a.start - b.start);
}

// Drops clips older than `before`, for every room (old matches shouldn't fill the phone)
export async function pruneClips(before: number): Promise<void> {
  await tx('readwrite', (s) => {
    const req = s.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      if ((cur.value as StoredClip).end < before) cur.delete();
      cur.continue();
    };
  }).catch(() => {});
}
