'use client';
import React from 'react';
import st from './CommentaryList.module.css';

export type LogEntry = {
  over: string; bat: string; bowl: string; runs: number; extra?: string; wicket?: boolean;
  score: string; text: string; kind: 'four' | 'six' | 'wicket' | 'extra' | 'run' | 'dot';
  // When it was scored (ms), to find the ball inside a match recording. Older logs don't have it.
  at?: number;
};

const badgeLabel = (e: LogEntry) => {
  if (e.wicket) return 'W';
  if (e.extra === 'db') return `DB${e.runs ? '+' + e.runs : ''}`;
  if (e.extra === 'rh') return 'RH';
  if (e.extra === 'ro') return 'RO';
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
        return (
          <div key={`${e.over}-${log.length - i}`} className={`${st.row} ${big ? st.rowBig : ''} ${e.kind === 'wicket' ? st.rowWicket : ''}`}>
            <div className={st.left}>
              <span className={st.over}>{e.over}</span>
              <div className={`${st.badge} ${st[`k_${e.kind}`] ?? ''}`}>
                <span className={st.badgeText}>{badgeLabel(e)}</span>
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
