'use client';
import React, { useEffect, useState } from 'react';
import { getApiUrl } from '@/lib/services/server';
import { shareText } from '@/lib/share';
import s from './MatchVideoScreen.module.css';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// Plays the match inside the app: the live camera stream while it's on, then the innings videos,
// ball-by-ball replays and the full match video (the same page viewers get from the watch link).
export default function MatchVideoScreen({ navigation, route }: any) {
  const { code, title } = route.params as { code: string; title?: string };
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    getApiUrl()
      .then(base => setUrl(`${base.replace(/\/api\/?$/, '')}/stream/match/${code}`))
      .catch(() => setFailed(true));
  }, [code]);

  return (
    <div className={s.container}>
      <div className={s.header}>
        <div className={s.headerInner}>
          <button type="button" className={cx(s.btnReset, s.headerBtn)} onClick={() => navigation.goBack()} aria-label="Back">
            <span className={s.back}>‹</span>
          </button>
          <div className={s.headerMid}>
            <div className={cx(s.title, s.one)}>{title || 'Match videos'}</div>
            <div className={s.sub}>Live · replays · innings videos</div>
          </div>
          <button
            type="button"
            className={cx(s.btnReset, s.headerBtn)}
            disabled={!url}
            onClick={() => { if (url) shareText(`Watch the match: ${url}`, url).catch(() => {}); }}>
            <span className={s.action}>↗ Share</span>
          </button>
        </div>
      </div>

      {failed ? (
        <div className={s.center}>
          <div className={s.errTitle}>Could not open the match videos</div>
          <div className={s.errBody}>Check the server address (⚙️ on Home) and your internet connection.</div>
          <button type="button" className={cx(s.btnReset, s.retry)} onClick={() => { setFailed(false); setLoading(true); setAttempt(a => a + 1); }}>
            <span className={s.retryText}>Try again</span>
          </button>
        </div>
      ) : url ? (
        <iframe
          key={attempt}
          src={url}
          className={s.web}
          title={title || 'Match videos'}
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          onLoad={() => setLoading(false)}
          onError={() => setFailed(true)}
        />
      ) : null}
      {loading && !failed && (
        <div className={s.loader}>
          <div className={s.spinner} />
        </div>
      )}
    </div>
  );
}
