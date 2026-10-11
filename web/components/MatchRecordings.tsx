'use client';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getApiUrl } from '@/lib/services/server';
import { popup } from './Popup';
import type { LogEntry } from './CommentaryList';
import st from './MatchRecordings.module.css';

// Recordings of this match made on the camera phone (/go page, "Save to: Server / YouTube"),
// for the scorer: play them, jump to any ball, download, delete, or send to YouTube.
// Access uses the match's live-session token, so only phones in the match can see them.

type Rec = {
  id: string; target: 'server' | 'youtube'; status: 'recording' | 'saved' | 'uploading' | 'uploaded' | 'failed';
  bytes: number; ext: string; title: string; createdAt: number; updatedAt: number;
  youtube: { progress: number; videoId: string | null; error: string | null };
};
type Moment = LogEntry & { innings: number };

// The scorer taps a few seconds after the ball, so a clip starts a little before that
const CLIP_LEAD_S = 12;

const mb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : `${(n / 1e6).toFixed(n < 1e7 ? 1 : 0)} MB`);
const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const pref = (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };

export default function MatchRecordings({ code, token, logs }: {
  code: string; token: string;
  // Ball-by-ball logs of the innings (1st, 2nd), for jumping to a ball inside a recording
  logs?: (LogEntry[] | undefined)[];
}) {
  const [base, setBase] = useState<string | null>(null);
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [error, setError] = useState('');
  const [playing, setPlaying] = useState<string | null>(null);
  const [allBalls, setAllBalls] = useState(false);
  const [yt, setYt] = useState<{ ok: boolean; acct: string }>({ ok: false, acct: '' });
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => { getApiUrl().then(setBase).catch(() => setError('Could not reach the server.')); }, []);

  const load = useCallback(async () => {
    if (!base) return;
    try {
      const res = await fetch(`${base}/stream-rec/${code}?t=${encodeURIComponent(token)}`, { cache: 'no-store' });
      const d = await res.json();
      setRecs(d.recordings || []);
      setError('');
    } catch {
      setError('Could not load the recordings. Check your internet.');
    }
  }, [base, code, token]);

  useEffect(() => {
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, [load]);

  // "Send to YouTube" works when this browser has a channel connected (on the camera page)
  useEffect(() => {
    if (!base) return;
    const acct = pref('cs.ytAcct');
    fetch(`${base}/stream-rec/youtube?acct=${encodeURIComponent(acct)}`).then(r => r.json())
      .then(d => setYt({ ok: !!d.configured && !!d.connected, acct })).catch(() => {});
  }, [base]);

  const fileUrl = (r: Rec, inline = false) =>
    `${base}/stream-rec/${code}/${r.id}/file?t=${encodeURIComponent(token)}${inline ? '&inline=1' : ''}`;

  const remove = (r: Rec) => popup.show({
    type: 'warning', icon: '🗑️', title: 'Delete Recording?',
    message: r.status === 'recording'
      ? 'This recording is still being made on the camera phone. Deleting it stops it from being saved on the server.'
      : `The ${mb(r.bytes)} video from ${time(r.createdAt)} will be deleted from the server. This can't be undone.`,
    buttons: [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => {
        const res = await fetch(`${base}/stream-rec/${code}/${r.id}?t=${encodeURIComponent(token)}`, { method: 'DELETE' }).catch(() => null);
        const d = res ? await res.json().catch(() => ({})) : {};
        if (!res?.ok) popup.alert('Could Not Delete', d.error || 'Check your internet and try again.', undefined, 'error');
        if (playing === r.id) setPlaying(null);
        load();
      } },
    ],
  });

  const toYouTube = async (r: Rec) => {
    const res = await fetch(`${base}/stream-rec/${code}/${r.id}/youtube`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: token, acct: yt.acct, privacy: pref('cs.ytPrivacy') || 'unlisted' }),
    }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) popup.alert('YouTube Upload', d.error || 'Could not start the upload.', undefined, 'error');
    load();
  };

  // Balls scored while a recording was running (the log has the time of each ball)
  const momentsIn = (r: Rec): Moment[] => {
    const end = r.updatedAt + 60_000;
    const all = (logs || []).flatMap((log, i) => (log || []).map(e => ({ ...e, innings: i + 1 })));
    return all.filter(e => typeof e.at === 'number' && e.at >= r.createdAt && e.at <= end
      && e.extra !== 'rh' && e.extra !== 'ro' // retirements aren't balls
      && (allBalls || e.kind === 'four' || e.kind === 'six' || e.kind === 'wicket'));
  };

  const jump = (r: Rec, m: Moment) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.max(0, (m.at! - r.createdAt) / 1000 - CLIP_LEAD_S);
    v.play().catch(() => {});
  };

  const label = (r: Rec) => {
    if (r.status === 'recording') return { text: '⏺ Recording now…', tone: st.live };
    if (r.status === 'uploading') return { text: `▶ Uploading to YouTube… ${r.youtube.progress || 0}%`, tone: st.busy };
    if (r.status === 'uploaded') return { text: '✅ On YouTube', tone: st.ok };
    if (r.status === 'failed') return { text: `⚠️ YouTube upload failed${r.youtube.error ? `: ${r.youtube.error}` : ''}`, tone: st.err };
    return { text: '☁️ Saved on the server', tone: st.ok };
  };

  return (
    <div className={st.card}>
      <div className={st.head}>
        <span className={st.icon} aria-hidden>🎥</span>
        <div className={st.headText}>
          <span className={st.title}>Match recordings</span>
          <span className={st.sub}>Watch, jump to any ball, download, delete or upload</span>
        </div>
      </div>

      {error && <div className={st.note}>{error}</div>}
      {!error && recs === null && <div className={st.note}>Loading…</div>}
      {recs?.length === 0 && (
        <div className={st.note}>
          No recordings on the server yet. On the camera phone tap <b>⏺</b> and choose <b>Server</b> or <b>YouTube</b>:
          the video is saved while you stream and shows up here. Videos saved to <b>This phone</b> stay on the camera phone.
        </div>
      )}

      {recs?.map(r => {
        const l = label(r);
        const open = playing === r.id;
        const moments = open ? momentsIn(r) : [];
        return (
          <div key={r.id} className={st.item}>
            <div className={st.row}>
              <div className={st.info}>
                <span className={`${st.status} ${l.tone}`}>{l.text}</span>
                <span className={st.meta}>Started {time(r.createdAt)} · {mb(r.bytes)}</span>
              </div>
            </div>
            <div className={st.actions}>
              {r.bytes > 0 && (
                <button type="button" className={`${st.btn} ${st.primary}`} onClick={() => setPlaying(open ? null : r.id)}>
                  {open ? '✕ Close' : '▶ Watch'}
                </button>
              )}
              {r.bytes > 0 && <a className={st.btn} href={fileUrl(r)} download>⬇ Download</a>}
              {r.youtube.videoId && (
                <a className={st.btn} href={`https://youtu.be/${r.youtube.videoId}`} target="_blank" rel="noopener noreferrer">▶ YouTube</a>
              )}
              {yt.ok && (r.status === 'saved' || r.status === 'failed') && r.bytes > 0 && (
                <button type="button" className={st.btn} onClick={() => toYouTube(r)}>
                  {r.status === 'failed' ? '↻ Retry YouTube' : '⇪ Upload to YouTube'}
                </button>
              )}
              <button type="button" className={`${st.btn} ${st.danger}`} onClick={() => remove(r)} aria-label="Delete recording">🗑 Delete</button>
            </div>

            {open && (
              <div className={st.player}>
                <video ref={video} className={st.video} src={fileUrl(r, true)} controls playsInline preload="metadata" />
                <div className={st.clipsHead}>
                  <span className={st.clipsTitle}>Jump to a ball</span>
                  <div className={st.toggle}>
                    {[false, true].map(all => (
                      <button key={String(all)} type="button" className={`${st.tg} ${allBalls === all ? st.tgOn : ''}`} onClick={() => setAllBalls(all)}>
                        {all ? 'All balls' : '4s · 6s · Wickets'}
                      </button>
                    ))}
                  </div>
                </div>
                {moments.length ? (
                  <div className={st.clips}>
                    {moments.map((m, i) => (
                      <button key={`${m.innings}-${m.over}-${i}`} type="button" className={`${st.clip} ${st[`k_${m.kind}`] ?? ''}`} onClick={() => jump(r, m)}>
                        <b>{m.over}</b>
                        <span>{m.kind === 'six' ? 'SIX' : m.kind === 'four' ? 'FOUR' : m.kind === 'wicket' ? 'WICKET' : m.extra ? `${m.extra === 'db' ? 'DB' : m.extra.toUpperCase()}${m.runs ? '+' + m.runs : ''}` : m.runs}</span>
                        <small>{m.wicket ? m.bat : m.bat.split(' ')[0]}</small>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className={st.note}>
                    {allBalls ? 'No balls were scored while this recording was running.' : 'No fours, sixes or wickets in this recording yet. Try “All balls”.'}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
