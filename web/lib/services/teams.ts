import AsyncStorage from '../storage';
import { getApiUrl, fetchWithTimeout, testServer, refreshApiUrl } from './server';
import { getDeviceId } from './live';

export type PlayerRole = 'Batter' | 'Bowler' | 'All-Rounder' | 'Captain' | 'Keeper' | 'Impact Player';
export type SharedPlayer = { name: string; nickname?: string; mobile?: string; roles: PlayerRole[] };
export type SharedTeam = {
  id: string; name: string; players: SharedPlayer[]; captain: string;
  createdBy: string; createdAt: number; updatedAt: number; mine: boolean;
  // Saved on this phone only; waiting to be synced to the server
  pending?: boolean;
};

// Offline support: the last server list is cached, and changes made while the server can't be
// reached are queued here and sent by syncPendingTeams() once it's reachable again.
const CACHE_KEY = 'cricscore_teams_cache';
const PENDING_KEY = 'cricscore_teams_pending';
const LOCAL_PREFIX = 'local-';

type PendingOp =
  | { op: 'create'; localId: string; name: string; players: SharedPlayer[]; createdBy: string; at: number }
  | { op: 'update'; id: string; name: string; players: SharedPlayer[]; at: number }
  | { op: 'delete'; id: string; name: string; at: number };

// Flag (not a subclass) so the check survives Babel's class transform
const networkError = () => Object.assign(new Error('No connection to the CricScore server'), { network: true });
const isNetwork = (e: any) => !!e?.network;

const call = async (method: string, path: string, body?: any, retried = false): Promise<any> => {
  const base = await getApiUrl();
  let res: Response;
  try {
    res = await fetchWithTimeout(`${base}/shared-teams${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }, 10000);
  } catch {
    if (!retried && (await refreshApiUrl()) !== base) return call(method, path, body, true);
    throw networkError();
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
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
const getPending = () => readJson<PendingOp[]>(PENDING_KEY, []);
const setPending = (ops: PendingOp[]) => AsyncStorage.setItem(PENDING_KEY, JSON.stringify(ops));

const captainOf = (players: SharedPlayer[]) =>
  players.find(p => p.roles.includes('Captain'))?.name || players[0]?.name || '';

// Applies queued (unsynced) changes on top of a server/cached list
const withPending = (list: SharedTeam[], ops: PendingOp[]): SharedTeam[] => {
  let out = [...list];
  for (const o of ops) {
    if (o.op === 'create') {
      out.unshift({
        id: o.localId, name: o.name, players: o.players, captain: captainOf(o.players),
        createdBy: o.createdBy, createdAt: o.at, updatedAt: o.at, mine: true, pending: true,
      });
    } else if (o.op === 'update') {
      out = out.map(t => (t.id === o.id
        ? { ...t, name: o.name, players: o.players, captain: captainOf(o.players), updatedAt: o.at, pending: true }
        : t));
    } else {
      out = out.filter(t => t.id !== o.id);
    }
  }
  return out;
};

const matches = (t: SharedTeam, q: string) =>
  !q || t.name.toLowerCase().includes(q) || t.players.some(p => p.name.toLowerCase().includes(q));

export const pendingTeamCount = async () => (await getPending()).length;

export const isServerReachable = async () => (await testServer(await getApiUrl())) || testServer(await refreshApiUrl());

// Server list when online (and refresh the cache); cached copy + local changes when offline
export const listTeams = async (search = ''): Promise<{ teams: SharedTeam[]; offline: boolean }> => {
  const q = search.trim().toLowerCase();
  const ops = await getPending();
  try {
    const all: SharedTeam[] = await call('GET', `?deviceId=${encodeURIComponent(await getDeviceId())}`);
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify(all)).catch(() => {});
    return { teams: withPending(all, ops).filter(t => matches(t, q)), offline: false };
  } catch (e) {
    if (!isNetwork(e)) throw e;
    const cached = await readJson<SharedTeam[]>(CACHE_KEY, []);
    return { teams: withPending(cached, ops).filter(t => matches(t, q)), offline: true };
  }
};

const nameTaken = async (name: string, exceptId?: string) => {
  const cached = await readJson<SharedTeam[]>(CACHE_KEY, []);
  return withPending(cached, await getPending())
    .some(t => t.id !== exceptId && t.name.toLowerCase() === name.trim().toLowerCase());
};

export const createTeam = async (name: string, players: SharedPlayer[], createdBy: string): Promise<SharedTeam> => {
  try {
    return await call('POST', '', { name, players, createdBy, deviceId: await getDeviceId() });
  } catch (e) {
    if (!isNetwork(e)) throw e;
    if (await nameTaken(name)) throw new Error(`A team named "${name}" already exists`);
    const op: PendingOp = { op: 'create', localId: `${LOCAL_PREFIX}${Date.now()}`, name, players, createdBy, at: Date.now() };
    await setPending([...(await getPending()), op]);
    return withPending([], [op])[0];
  }
};

export const updateTeam = async (id: string, name: string, players: SharedPlayer[]): Promise<SharedTeam | null> => {
  const ops = await getPending();
  // Not on the server yet: just edit the queued create
  if (id.startsWith(LOCAL_PREFIX)) {
    await setPending(ops.map(o => (o.op === 'create' && o.localId === id ? { ...o, name, players } : o)));
    return null;
  }
  try {
    const team = await call('PUT', `/${id}`, { name, players, deviceId: await getDeviceId() });
    await setPending(ops.filter(o => !(o.op === 'update' && o.id === id)));
    return team;
  } catch (e) {
    if (!isNetwork(e)) throw e;
    await setPending([...ops.filter(o => !(o.op === 'update' && o.id === id)), { op: 'update', id, name, players, at: Date.now() }]);
    return null;
  }
};

export const deleteTeam = async (id: string, name: string) => {
  const ops = await getPending();
  if (id.startsWith(LOCAL_PREFIX)) {
    await setPending(ops.filter(o => !(o.op === 'create' && o.localId === id)));
    return;
  }
  try {
    await call('DELETE', `/${id}?deviceId=${encodeURIComponent(await getDeviceId())}`);
    await setPending(ops.filter(o => o.op === 'create' || o.id !== id));
  } catch (e) {
    if (!isNetwork(e)) throw e;
    await setPending([...ops.filter(o => o.op === 'create' || o.id !== id), { op: 'delete', id, name, at: Date.now() }]);
  }
};

// Sends queued changes in order. Stops at the first connection failure (the rest stay queued);
// changes the server rejects (e.g. duplicate name) are dropped and reported.
export const syncPendingTeams = async (): Promise<{ synced: number; failed: { name: string; error: string }[]; offline: boolean }> => {
  const ops = await getPending();
  const deviceId = await getDeviceId();
  const failed: { name: string; error: string }[] = [];
  let synced = 0;
  let i = 0;
  for (; i < ops.length; i++) {
    const o = ops[i];
    try {
      if (o.op === 'create') await call('POST', '', { name: o.name, players: o.players, createdBy: o.createdBy, deviceId });
      else if (o.op === 'update') await call('PUT', `/${o.id}`, { name: o.name, players: o.players, deviceId });
      else await call('DELETE', `/${o.id}?deviceId=${encodeURIComponent(deviceId)}`);
      synced++;
    } catch (e: any) {
      if (isNetwork(e)) break;
      failed.push({ name: o.name, error: e.message });
    }
  }
  await setPending(ops.slice(i));
  return { synced, failed, offline: i < ops.length };
};
