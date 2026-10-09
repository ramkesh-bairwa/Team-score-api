'use client';
import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import st from './Celebration.module.css';

export type CelebrationKind = 'four' | 'six';
export type CelebrationEvent = { kind: CelebrationKind; batter: string; id: number; line?: string };

const DURATION_MS = 3000;
const BURST = ['🎉', '✨', '🎊', '⭐', '🔥', '🏏', '✨', '🎉'];

const THEME: Record<CelebrationKind, { title: string; sub: string; color: string; glow: string }> = {
  four: { title: 'FOUR!', sub: 'Cracking boundary', color: '#2563EB', glow: '#60A5FA' },
  six: { title: 'SIX!', sub: 'Out of the park', color: '#7C3AED', glow: '#C084FC' },
};

// Full-screen celebration shown for 3 seconds after a boundary; tap to dismiss early
export default function Celebration({ event, onDone }: { event: CelebrationEvent | null; onDone: () => void }) {
  useEffect(() => {
    if (!event) return;
    const t = setTimeout(onDone, DURATION_MS);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDone(); };
    window.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); window.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event?.id]);

  if (!event || typeof document === 'undefined') return null;
  const th = THEME[event.kind];

  return createPortal(
    // key restarts all CSS animations for every new boundary
    <div key={event.id} className={st.overlay} onClick={onDone} role="dialog" aria-modal="true">
      <div className={st.rays} style={{ borderColor: th.glow + '55' }} />
      {BURST.map((e, i) => {
        const angle = (i / BURST.length) * Math.PI * 2;
        return (
          <span
            key={i}
            className={st.burst}
            style={{ '--bx': `${Math.cos(angle) * 150}px`, '--by': `${Math.sin(angle) * 150}px` } as React.CSSProperties}
          >
            {e}
          </span>
        );
      })}
      <div className={st.badge} style={{ backgroundColor: th.color, boxShadow: `0 0 30px ${th.glow}E6` }}>
        <span className={st.badgeEmoji}>{event.kind === 'six' ? '🚀' : '🏏'}</span>
        <span className={st.badgeTitle}>{th.title}</span>
      </div>
      <div className={st.texts}>
        <span className={st.congrats}>Congratulations {event.batter}! 🎉</span>
        <span className={st.sub}>{event.line || th.sub}</span>
      </div>
    </div>,
    document.body,
  );
}
