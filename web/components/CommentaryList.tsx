'use client';
import React from 'react';
import { C } from '@/lib/theme';
import st from './CommentaryList.module.css';

export type LogEntry = {
  over: string; bat: string; bowl: string; runs: number; extra?: string; wicket?: boolean;
  score: string; text: string; kind: 'four' | 'six' | 'wicket' | 'extra' | 'run' | 'dot';
};

const BADGE: Record<LogEntry['kind'], { bg: string; fg: string }> = {
  six: { bg: '#7C3AED', fg: C.white },
  four: { bg: C.accent, fg: C.white },
  wicket: { bg: C.primary, fg: C.white },
  extra: { bg: C.orangeLight, fg: C.orange },
  run: { bg: C.divider, fg: C.text },
  dot: { bg: C.divider, fg: C.textMuted },
};

const badgeLabel = (e: LogEntry) => {
  if (e.wicket) return 'W';
  if (e.extra === 'db') return 'DB';
  if (e.extra) return `${e.extra === 'b' ? 'B' : e.extra.toUpperCase()}${e.runs || ''}`;
  return e.runs === 0 ? '•' : String(e.runs);
};

// Ball-by-ball log, newest first: over, batter vs bowler, commentary line, score after the ball
export default function CommentaryList({ log, limit }: { log: LogEntry[]; limit?: number }) {
  const items = [...log].reverse().slice(0, limit ?? log.length);
  if (!items.length) return <div className={st.empty}>Ball-by-ball commentary appears here once play starts 🎙️</div>;
  return (
    <div className={st.list}>
      {items.map((e, i) => {
        const big = e.kind === 'four' || e.kind === 'six' || e.kind === 'wicket';
        const b = BADGE[e.kind];
        return (
          <div key={`${e.over}-${log.length - i}`} className={`${st.row} ${big ? st.rowBig : ''} ${e.kind === 'wicket' ? st.rowWicket : ''}`}>
            <div className={st.left}>
              <span className={st.over}>{e.over}</span>
              <div className={st.badge} style={{ backgroundColor: b.bg }}>
                <span className={st.badgeText} style={{ color: b.fg }}>{badgeLabel(e)}</span>
              </div>
            </div>
            <div className={st.body}>
              <span className={st.who}>{e.bowl} to {e.bat}</span>
              <span className={`${st.text} ${big ? st.textBig : ''}`}>{e.text}</span>
            </div>
            <span className={st.score}>{e.score}</span>
          </div>
        );
      })}
    </div>
  );
}
