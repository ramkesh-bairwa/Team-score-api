'use client';
import React, { useEffect, useRef, useState } from 'react';
import QRCode from './QRCode';
import { copyText, shareText } from '@/lib/share';
import st from './WatchLiveCard.module.css';

// For VIEWERS of a live match: QR of the watch page, the match code (tap to copy),
// copy / share the link and open the watch page in a new tab.
export default function WatchLiveCard({ code, title, compact = false }: { code: string; title?: string; compact?: boolean }) {
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // window is only available on the client (avoids a hydration mismatch)
  useEffect(() => {
    setUrl(`${window.location.origin}/stream/match/${code}`);
  }, [code]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const flash = (what: 'code' | 'link') => {
    setCopied(what);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1600);
  };

  const copyCode = async () => { if (await copyText(code)) flash('code'); };
  const copyLink = async () => { if (url && (await copyText(url))) flash('link'); };
  const share = () => {
    if (!url) return;
    shareText(`Watch ${title ? title : 'our match'} live on CricScore 🏏🔴\n${url}`, url, title || 'CricScore Live').catch(() => {});
  };
  const play = () => { if (url) window.open(url, '_blank', 'noopener'); };

  return (
    <section className={`${st.card} ${compact ? st.compact : ''}`} aria-label="Watch live">
      <header className={st.head}>
        <div className={st.headText}>
          <span className={st.kicker}><span className={st.dot} /> LIVE</span>
          <span className={st.title}>📺 Watch live</span>
          {!!title && <span className={st.sub}>{title}</span>}
        </div>
      </header>

      <div className={st.body}>
        <div className={st.qrTile}>
          {url ? <QRCode value={url} size={compact ? 116 : 176} color="#0B1730" /> : <div className={st.qrPlaceholder} />}
          <span className={st.qrHint}>Scan to watch</span>
        </div>

        <div className={st.side}>
          <button type="button" className={st.codeBtn} onClick={copyCode} aria-label={`Match code ${code}, tap to copy`}>
            <span className={st.codeLabel}>{copied === 'code' ? '✓ Code copied' : 'Match code · tap to copy'}</span>
            <span className={st.code}>{code}</span>
          </button>

          <div className={st.row}>
            <button type="button" className={`${st.btn} ${st.btnGhost}`} onClick={copyLink} disabled={!url}>
              {copied === 'link' ? '✓ Copied' : '🔗 Copy link'}
            </button>
            <button type="button" className={`${st.btn} ${st.btnGhost}`} onClick={share} disabled={!url}>
              ↗ Share
            </button>
          </div>

          <button type="button" className={`${st.btn} ${st.play}`} onClick={play} disabled={!url}>
            ▶ Play Now
          </button>
        </div>
      </div>
    </section>
  );
}
