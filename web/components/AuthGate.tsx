'use client';
// Every website page needs a login except /login. The mobile app never loads these pages.
// Wrapped around {children} in the root layout; useUser() gives the logged-in user to any client component.
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AuthUser, DEVICE_KEY, fetchMe, safeNext } from '@/lib/auth-client';
import st from './AuthGate.module.css';

type Status = 'loading' | 'in' | 'out' | 'error';
const UserContext = createContext<AuthUser | null>(null);

/** The logged-in user (null on /login or while checking). */
export const useUser = () => useContext(UserContext);

const PUBLIC_PATHS = ['/login'];
const isPublic = (path: string | null) => !!path && PUBLIC_PATHS.some(p => path === p || path.startsWith(`${p}/`));

export function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const publicPage = isPublic(pathname);
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  const check = useCallback(async () => {
    setStatus('loading');
    try {
      const me = await fetchMe();
      if (me) {
        // Keep "my matches/teams" tied to the account (e.g. after site data was cleared)
        try {
          if (localStorage.getItem(DEVICE_KEY) !== `web-${me.id}`) localStorage.setItem(DEVICE_KEY, `web-${me.id}`);
        } catch { /* storage blocked */ }
      }
      setUser(me);
      setStatus(me ? 'in' : 'out');
    } catch {
      setStatus('error');
    }
  }, []);

  useEffect(() => { check(); }, [check]);

  useEffect(() => {
    if (publicPage && status === 'in') {
      const next = new URLSearchParams(window.location.search).get('next');
      window.location.replace(safeNext(next));
    } else if (!publicPage && status === 'out') {
      const here = window.location.pathname + window.location.search;
      window.location.replace(`/login?next=${encodeURIComponent(here)}`);
    }
  }, [publicPage, status]);

  // The login page renders straight away (nothing private on it); it leaves once we know you're logged in.
  if (publicPage) {
    if (status === 'in') return <Loader />;
    return <UserContext.Provider value={null}>{children}</UserContext.Provider>;
  }
  if (status === 'in' && user) return <UserContext.Provider value={user}>{children}</UserContext.Provider>;
  if (status === 'error') {
    return (
      <div className={st.wrap}>
        <div className={st.ball} aria-hidden />
        <p className={st.msg}>Couldn&apos;t reach CricScore.</p>
        <button className={st.retry} onClick={check}>Try again</button>
      </div>
    );
  }
  return <Loader />;
}

function Loader() {
  return (
    <div className={st.wrap} role="status" aria-label="Loading">
      <div className={st.ball} aria-hidden />
    </div>
  );
}

export default AuthGate;
