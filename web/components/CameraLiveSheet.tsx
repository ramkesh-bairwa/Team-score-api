'use client';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import QRCode from './QRCode';
import { CameraStream, getStreamStatus } from '@/lib/services/stream';
import { shareText, openUrl } from '@/lib/share';
import st from './CameraLiveSheet.module.css';

type Tab = 'camera' | 'watch';

// Mount/unmount with the slide-up animation (RN Modal animationType="slide")
function useSheet(visible: boolean, onClose: () => void) {
  const [mounted, setMounted] = useState(visible);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      const t = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(t);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 260);
    return () => clearTimeout(t);
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onClose]);
  return { mounted, shown };
}

// Free WebRTC live stream: the camera phone scans a QR and goes live in its browser;
// viewers open the watch link on any phone and see the video with the live scoreboard.
export default function CameraLiveSheet({ visible, code, links, onClose, onYoutube }: {
  visible: boolean; code: string; links: CameraStream | null; onClose: () => void; onYoutube: () => void;
}) {
  const [tab, setTab] = useState<Tab>('camera');
  const [status, setStatus] = useState<{ live: boolean; viewers: number; maxViewers: number } | null>(null);
  const { mounted, shown } = useSheet(visible, onClose);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    const tick = () => getStreamStatus(code).then(s => { if (alive) setStatus(s); }).catch(() => {});
    tick();
    const t = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [visible, code]);

  const shareWatch = () => {
    if (links) shareText(`Watch our match live 🏏🔴\n${links.watchUrl}`).catch(() => {});
  };

  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(
    <div className={`${st.overlay} ${shown ? st.shown : ''}`} role="dialog" aria-modal="true">
      <div className={st.backdrop} onClick={onClose} />
      <div className={st.sheet}>
        <div className={st.handle} />
        <div className={st.scroll}>
          <div className={st.titleRow}>
            <span className={st.title}>📹 Live Stream</span>
            <div className={`${st.pill} ${status?.live ? st.pillLive : ''}`}>
              {status?.live && <div className={st.dot} />}
              <span className={st.pillText}>
                {status?.live ? `LIVE · 👁 ${status.viewers}/${status.maxViewers}` : 'NOT LIVE YET'}
              </span>
            </div>
          </div>
          <span className={st.sub}>Free, no YouTube or app needed. Works in Chrome or Safari.</span>

          <div className={st.tabs}>
            {([
              { key: 'camera', label: '📹 Camera phone' },
              { key: 'watch', label: '👀 Viewers' },
            ] as const).map(t => (
              <button key={t.key} type="button" className={`${st.tab} ${tab === t.key ? st.tabOn : ''}`} onClick={() => setTab(t.key)}>
                <span className={`${st.tabText} ${tab === t.key ? st.tabTextOn : ''}`}>{t.label}</span>
              </button>
            ))}
          </div>

          {!links ? (
            <span className={st.sub}>Preparing the stream…</span>
          ) : tab === 'camera' ? (
            <div className={st.center}>
              <QRCode value={links.broadcastUrl} size={220} />
              <span className={st.step}>1. On the camera phone, open the normal <span className={st.bold}>Camera</span> app and scan this QR.</span>
              <span className={st.step}>2. Open the link, allow camera &amp; mic, turn the phone sideways and tap <span className={st.bold}>GO LIVE</span>.</span>
              <span className={st.warn}>Keep this QR private: anyone who scans it can broadcast for this match.</span>
              <button type="button" className={`${st.btn} ${st.btnGhost}`} onClick={() => openUrl(links.broadcastUrl)}>
                <span className={st.btnGhostText}>Open camera page on this phone</span>
              </button>
            </div>
          ) : (
            <div className={st.center}>
              <QRCode value={links.watchUrl} size={180} />
              <span className={st.link}>{links.watchUrl}</span>
              <span className={st.step}>Anyone can open this link to watch live with the scoreboard (up to {links.maxViewers} viewers at once).</span>
              <button type="button" className={`${st.btn} ${st.btnRed}`} onClick={shareWatch}>
                <span className={st.btnText}>Share Watch Link</span>
              </button>
            </div>
          )}

          <button type="button" className={st.ytLink} onClick={onYoutube}>
            <span className={st.ytLinkText}>▶ Stream to YouTube instead (more viewers)</span>
          </button>
          <button type="button" className={st.close} onClick={onClose}>
            <span className={st.closeText}>← Back to match</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
