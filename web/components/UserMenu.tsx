'use client';
// Account chip for page headers: initials + name, dropdown with the mobile number and "Log out".
// <UserMenu /> on a white header, <UserMenu dark /> on a navy one. Renders nothing when not logged in.
import React, { useEffect, useRef, useState } from 'react';
import { useUser } from './AuthGate';
import { logoutAndRedirect } from '@/lib/auth-client';
import st from './UserMenu.module.css';

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('') || '?';
const prettyMobile = (m: string) => `+91 ${m.slice(0, 5)} ${m.slice(5)}`;

export function UserMenu({ dark = false, className }: { dark?: boolean; className?: string }) {
  const user = useUser();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  const first = user.name.trim().split(/\s+/)[0];

  return (
    <div ref={ref} className={`${st.root} ${dark ? st.dark : ''} ${className || ''}`}>
      <button
        type="button"
        className={st.chip}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span className={st.avatar}>{initials(user.name)}</span>
        <span className={st.name}>{first}</span>
        <svg className={`${st.caret} ${open ? st.caretOpen : ''}`} width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className={st.menu} role="menu">
          <div className={st.head}>
            <span className={`${st.avatar} ${st.avatarLg}`}>{initials(user.name)}</span>
            <div className={st.who}>
              <div className={st.fullName}>{user.name}</div>
              <div className={st.mobile}>{prettyMobile(user.mobile)}</div>
            </div>
          </div>
          <button
            type="button"
            role="menuitem"
            className={st.logout}
            disabled={busy}
            onClick={() => { setBusy(true); logoutAndRedirect(); }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
              <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {busy ? 'Logging out…' : 'Log out'}
          </button>
        </div>
      )}
    </div>
  );
}

export default UserMenu;
