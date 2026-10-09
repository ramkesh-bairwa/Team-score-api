import AsyncStorage from '../storage';
import { PUBLIC_SERVER_URLS } from '../publicServer';

const SERVER_KEY = 'cricscore_server_url';
// The website is served from the same domain as the API
export const DEFAULT_API_URL = typeof window !== 'undefined' ? `${window.location.origin}/api` : '/api';

let cached: string | null = null;
let reachable = false;
let resolving: Promise<string> | null = null;

const quickHealth = async (apiUrl: string, ms: number) => {
  try {
    const res = await fetchWithTimeout(`${apiUrl.replace(/\/api$/, '')}/health`, {}, ms);
    return res.ok;
  } catch {
    return false;
  }
};

// Picks the first reachable server, in priority order: address saved in the app, the public
// server, the address built into the app, then the emulator address. All are probed in parallel.
export const refreshApiUrl = (): Promise<string> => {
  if (resolving) return resolving;
  resolving = (async () => {
    const saved = await AsyncStorage.getItem(SERVER_KEY).catch(() => null);
    const candidates = [...new Set([saved, DEFAULT_API_URL, ...PUBLIC_SERVER_URLS]
      .filter((u): u is string => !!u))];
    // Settle as soon as the best-priority reachable address is known (don't wait for slow failures)
    const idx = await new Promise<number>(resolve => {
      const results: (boolean | undefined)[] = candidates.map(() => undefined);
      let grace: ReturnType<typeof setTimeout> | null = null;
      const best = () => results.findIndex(r => r === true);
      const decide = () => {
        for (let i = 0; i < results.length; i++) {
          if (results[i] === undefined) {
            // A better address is still being checked; once something works, wait at most 2.5s for it
            if (best() >= 0 && !grace) grace = setTimeout(() => resolve(best()), 2500);
            return;
          }
          if (results[i]) { if (grace) clearTimeout(grace); resolve(i); return; }
        }
        resolve(-1);
      };
      candidates.forEach((u, i) => quickHealth(u, 8000).then(ok => { results[i] = ok; decide(); }));
    });
    reachable = idx >= 0;
    cached = idx >= 0 ? candidates[idx] : candidates[0];
    return cached;
  })().finally(() => { resolving = null; });
  return resolving;
};

// The server address can be changed in-app (no rebuild); otherwise it is found automatically
export const getApiUrl = async () => cached || refreshApiUrl();

// True when some server address answered (probes again if needed)
export const isServerConfigured = async () => {
  if (!reachable) await refreshApiUrl();
  return reachable;
};

// Accepts "192.168.1.49", "192.168.1.49:3000", "http://host:3000" or a full ".../api" URL
export const normalizeApiUrl = (input: string) => {
  let url = input.trim().replace(/\/+$/, '');
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  if (/^http:\/\/[^/:]+$/i.test(url)) url += ':3000';
  if (!/\/api$/.test(url)) url += '/api';
  return url;
};

export const setApiUrl = async (input: string) => {
  const url = normalizeApiUrl(input);
  if (url) await AsyncStorage.setItem(SERVER_KEY, url);
  else await AsyncStorage.removeItem(SERVER_KEY);
  cached = url || null;
  return refreshApiUrl();
};

// Free hosts (e.g. Render) sleep when idle and can take up to a minute to wake up
export const fetchWithTimeout = async (url: string, init: RequestInit = {}, ms = 20000) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
};

export const testServer = async (apiUrl: string): Promise<boolean> => {
  try {
    const res = await fetchWithTimeout(`${apiUrl.replace(/\/api$/, '')}/health`, {}, 60000);
    return res.ok;
  } catch {
    return false;
  }
};
