'use client';
import React, { useState } from 'react';
import { LiveSession, sendReplay } from '@/lib/services/live';
import st from './ReplayControls.module.css';

const OPTIONS: { label: string; seconds: number; rate: number }[] = [
  { label: '30s', seconds: 30, rate: 1 },
  { label: '1 min', seconds: 60, rate: 1 },
  { label: '2 min', seconds: 120, rate: 1 },
  { label: '3 min', seconds: 180, rate: 1 },
  { label: '🐢 Slow-mo', seconds: 10, rate: 0.5 },
];

// Replay buttons for the match's camera stream: the replay plays on the camera device and every
// viewer sees it with a REPLAY tag, then it cuts back to live by itself
export default function ReplayControls({ session, dark = true }: { session: LiveSession; dark?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async (key: string, action: 'start' | 'stop', seconds?: number, rate?: number) => {
    setBusy(key);
    setMsg(null);
    try {
      await sendReplay(session, action, seconds, rate);
      setMsg({ ok: true, text: action === 'stop' ? 'Back to live' : `Replay on air (${key})` });
    } catch (e: any) {
      setMsg({ ok: false, text: e.message || 'Replay failed' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`${st.box} ${!dark ? st.boxLight : ''}`}>
      <span className={st.title}>⏪ Replay on the live stream</span>
      <div className={st.row}>
        {OPTIONS.map(o => (
          <button key={o.label} type="button" className={st.btn} disabled={!!busy} onClick={() => run(o.label, 'start', o.seconds, o.rate)}>
            {busy === o.label ? <span className={st.spinner} /> : <span className={st.btnText}>{o.label}</span>}
          </button>
        ))}
        <button type="button" className={`${st.btn} ${st.stop}`} disabled={!!busy} onClick={() => run('stop', 'stop')}>
          {busy === 'stop' ? <span className={st.spinner} /> : <span className={st.btnText}>■ Live</span>}
        </button>
      </div>
      {msg ? (
        <span className={`${st.msg} ${msg.ok ? st.ok : st.err}`}>{msg.ok ? '✅ ' : '⛔ '}{msg.text}</span>
      ) : (
        <span className={st.hint}>Plays on the camera device and every viewer&apos;s screen, then returns to live.</span>
      )}
    </div>
  );
}
