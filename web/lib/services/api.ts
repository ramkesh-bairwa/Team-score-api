import AsyncStorage from '../storage';
import { getApiUrl, fetchWithTimeout, refreshApiUrl } from './server';
import { getDeviceId } from './live';

const IN_PROGRESS_KEY = 'cricscore_inprogress_match';

// ─── IN PROGRESS (resume after leaving the scoring screen) ──

export const saveInProgressMatch = async (state: any) => {
  await AsyncStorage.setItem(IN_PROGRESS_KEY, JSON.stringify({ ...state, status: 'inprogress', savedAt: Date.now() }));
};

export const getInProgressMatch = async () => {
  const data = await AsyncStorage.getItem(IN_PROGRESS_KEY);
  return data ? JSON.parse(data) : null;
};

export const clearInProgressMatch = async () => {
  await AsyncStorage.removeItem(IN_PROGRESS_KEY);
};

// ─── MATCHES (server API: /api/v2/matches) ─────────────────
// Every write is kept on the phone first (so nothing is lost without internet) and queued;
// the queue is uploaded as soon as the server is reachable.

const MATCHES_KEY = 'cricscore_matches_v2';         // id -> full match record (this phone's matches)
const MATCH_PENDING_KEY = 'cricscore_matches_pending'; // ids still to upload

export type MatchSummary = {
  id: string; team1: string; team2: string; overs: number; matchType: string; location?: string;
  status: string; result: string; score: string; oversPlayed: string; score2: string; oversPlayed2: string;
  ballType?: string; createdAt: number; updatedAt: number; pending?: boolean; date: string;
};

const randomId = (len: number) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
};

// Created once per match (at the toss) and carried in the match params
export const newMatchIdentity = () => ({ matchId: `m-${Date.now().toString(36)}-${randomId(6)}`, matchKey: randomId(32) });

const apiCall = async (method: string, path: string, body?: any, retried = false): Promise<any> => {
  const base = await getApiUrl();
  let res: Response;
  try {
    res = await fetchWithTimeout(`${base}/v2/matches${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }, 15000);
  } catch {
    if (!retried && (await refreshApiUrl()) !== base) return apiCall(method, path, body, true);
    throw Object.assign(new Error('No connection to the CricScore server'), { network: true });
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong'), { status: res.status });
  return data;
};

const readJson = async <T,>(key: string, fallback: T): Promise<T> => {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};
const localMatches = () => readJson<Record<string, any>>(MATCHES_KEY, {});
const pendingIds = () => readJson<string[]>(MATCH_PENDING_KEY, []);

// Serialize local read-modify-write so overlapping saves don't drop each other
let queue: Promise<any> = Promise.resolve();
const serial = <T,>(fn: () => Promise<T>): Promise<T> => {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
};

const toSummary = (m: any, pending = false): MatchSummary => ({
  id: m.id, team1: m.team1?.name || '', team2: m.team2?.name || '', overs: m.overs,
  matchType: m.matchType, location: m.location, status: m.status, result: m.result || '',
  score: m.innings1 ? `${m.innings1.runs}/${m.innings1.wickets}` : '',
  oversPlayed: m.innings1 ? `${m.innings1.overs}.${m.innings1.balls}` : '',
  score2: m.innings2 ? `${m.innings2.runs}/${m.innings2.wickets}` : '',
  oversPlayed2: m.innings2 ? `${m.innings2.overs}.${m.innings2.balls}` : '',
  ballType: m.bet?.ballType, createdAt: m.createdAt, updatedAt: m.updatedAt, pending,
  date: new Date(m.createdAt || Date.now()).toLocaleDateString('en-IN'),
});

const upload = async (rec: any) => {
  const { key, ...fields } = rec;
  await apiCall('PUT', `/${rec.id}`, { ...fields, key, deviceId: await getDeviceId() });
};

// Uploads every queued match. Stops at the first connection failure; matches the server
// rejects are dropped from the queue (they stay on this phone).
export const syncPendingMatches = (): Promise<{ synced: number; offline: boolean }> => serial(async () => {
  const ids = await pendingIds();
  const all = await localMatches();
  let synced = 0;
  let i = 0;
  for (; i < ids.length; i++) {
    const rec = all[ids[i]];
    if (!rec) continue;
    try {
      await upload(rec);
      synced++;
    } catch (e: any) {
      if (e.network) break;
    }
  }
  await AsyncStorage.setItem(MATCH_PENDING_KEY, JSON.stringify(ids.slice(i)));
  return { synced, offline: i < ids.length };
});

export const pendingMatchCount = async () => (await pendingIds()).length;

// Create or update a match: saved on the phone, then sent to the API (queued if offline)
export const upsertMatch = async (id: string, key: string, fields: Record<string, any>) => {
  if (!id || !key) return;
  await serial(async () => {
    const all = await localMatches();
    const now = Date.now();
    all[id] = { ...(all[id] || { id, createdAt: now, status: 'live' }), ...fields, id, key, updatedAt: now };
    await AsyncStorage.setItem(MATCHES_KEY, JSON.stringify(all));
    const ids = await pendingIds();
    if (!ids.includes(id)) await AsyncStorage.setItem(MATCH_PENDING_KEY, JSON.stringify([...ids, id]));
  });
  syncPendingMatches().catch(() => {});
};

// This phone's matches: from the API when online (plus anything not uploaded yet), else the local copy
export const listMatches = async (): Promise<{ matches: MatchSummary[]; offline: boolean }> => {
  const all = await localMatches();
  const pending = new Set(await pendingIds());
  try {
    const server: any[] = await apiCall('GET', `?mine=1&deviceId=${encodeURIComponent(await getDeviceId())}`);
    const ids = new Set(server.map(m => m.id));
    const localOnly = Object.values(all).filter(m => !ids.has(m.id) || pending.has(m.id));
    const merged = [
      ...localOnly.map(m => toSummary(m, pending.has(m.id))),
      ...server.filter(m => !pending.has(m.id)).map(m => ({ ...m, date: new Date(m.createdAt).toLocaleDateString('en-IN') })),
    ];
    return { matches: merged.sort((a, b) => b.createdAt - a.createdAt), offline: false };
  } catch (e: any) {
    if (!e.network) throw e;
    const list = Object.values(all).map(m => toSummary(m, pending.has(m.id)));
    return { matches: list.sort((a, b) => b.createdAt - a.createdAt), offline: true };
  }
};

// Full match (innings, ball-by-ball log): local copy first, else the API
export const getMatch = async (id: string) => {
  const all = await localMatches();
  if (all[id]) return all[id];
  return apiCall('GET', `/${id}?deviceId=${encodeURIComponent(await getDeviceId())}`);
};

// Deletes this phone's matches from the server (best effort) and clears the local copy
export const clearMyMatches = () => serial(async () => {
  const all = await localMatches();
  const pending = new Set(await pendingIds());
  for (const m of Object.values(all)) {
    if (pending.has(m.id) || !m.key) continue; // never uploaded: nothing to delete remotely
    try { await apiCall('DELETE', `/${m.id}?key=${encodeURIComponent(m.key)}`); } catch (_) {}
  }
  await AsyncStorage.removeItem(MATCHES_KEY);
  await AsyncStorage.removeItem(MATCH_PENDING_KEY);
});
