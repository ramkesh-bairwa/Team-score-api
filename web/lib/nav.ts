'use client';
// Screen navigation with the same shape as the app's React Navigation calls:
//   const nav = useNav(); nav.navigate('Scoring', params); nav.replace(...); nav.goBack();
//   const { params, key } = useRouteParams('Scoring');
// Params can be large objects (teams, saved scoring state), so they travel in sessionStorage
// (survives a page refresh) instead of the URL.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export type Screen =
  | 'Welcome' | 'Home' | 'SetupTeam' | 'Bet' | 'Toss' | 'Scoring' | 'Scorecard'
  | 'Teams' | 'LiveStream' | 'MatchVideo';

const PATHS: Record<Screen, string> = {
  Welcome: '/welcome', Home: '/', SetupTeam: '/setup', Bet: '/bet', Toss: '/toss',
  Scoring: '/scoring', Scorecard: '/scorecard', Teams: '/teams', LiveStream: '/live', MatchVideo: '/video',
};

const EVENT = 'cricscore:nav';
const storeKey = (screen: Screen) => `cricscore_nav_${screen}`;

type Entry = { params: any; key: number };

const read = (screen: Screen): Entry => {
  try {
    const raw = sessionStorage.getItem(storeKey(screen));
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { params: undefined, key: 0 };
};

const write = (screen: Screen, params: any) => {
  const entry: Entry = { params, key: Date.now() };
  try { sessionStorage.setItem(storeKey(screen), JSON.stringify(entry)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: screen }));
};

export const pathOf = (screen: Screen, params?: any) =>
  screen === 'MatchVideo' && params?.code ? `/video/${params.code}` : PATHS[screen];

export function useNav() {
  const router = useRouter();
  return useMemo(() => ({
    navigate(screen: Screen, params?: any) {
      write(screen, params);
      const path = pathOf(screen, params);
      if (window.location.pathname === path) return; // same screen: params update remounts it
      router.push(path);
    },
    replace(screen: Screen, params?: any) {
      write(screen, params);
      const path = pathOf(screen, params);
      if (window.location.pathname !== path) router.replace(path);
    },
    goBack() {
      if (window.history.length > 1) router.back();
      else router.push('/');
    },
  }), [router]);
}

// Params the screen was opened with. `key` changes when the screen is re-opened with new params,
// so pages render <Screen key={key} /> to start fresh like a new React Navigation route.
export function useRouteParams<T = any>(screen: Screen): { params: T | undefined; key: number; ready: boolean } {
  const [state, setState] = useState<{ entry: Entry; ready: boolean }>({ entry: { params: undefined, key: 0 }, ready: false });
  useEffect(() => {
    setState({ entry: read(screen), ready: true });
    const on = (e: Event) => {
      if ((e as CustomEvent).detail === screen) setState({ entry: read(screen), ready: true });
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [screen]);
  return { params: state.entry.params as T | undefined, key: state.entry.key, ready: state.ready };
}

// Runs `handler` when the browser Back button is pressed (Android hardware back in the app).
// Return true to stay on the page (e.g. after asking "Leave the match?"), false to go back.
export function useBackHandler(handler: () => boolean) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const guard = { cricscoreGuard: Date.now() };
    window.history.pushState(guard, '');
    const onPop = () => {
      if (ref.current()) window.history.pushState(guard, '');
      else window.history.back();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
}
