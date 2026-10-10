'use client';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LiveSession, LivePayload, getOverlayLink, isLocalAddress } from '@/lib/services/live';
import { createCameraStream } from '@/lib/services/stream';
import ServerSettings from './ServerSettings';
import QRCode from './QRCode';
import ReplayControls from './ReplayControls';
import { popup } from './Popup';
import { shareText, openUrl } from '@/lib/share';
import st from './YouTubeLiveSheet.module.css';

const STEPS = [
  { title: 'Open a streaming app', body: 'Install Prism Live Studio or Streamlabs on a phone (or OBS on a laptop) and sign in with your YouTube channel.' },
  { title: 'Add the score overlay', body: 'Add a "Web" / "Browser" widget (overlay) and paste the link below. Set size to 1280 × 720 and keep the background transparent.' },
  { title: 'Point the camera & go live', body: 'Frame the ground, start the stream to YouTube. The scoreboard updates on its own every time you score a ball here.' },
];

// Mount/unmount with the slide-up animation (RN Modal animationType="slide")
function useSheet(visible: boolean, onClose: () => void, blockEscape: boolean) {
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
    if (!visible || blockEscape) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [visible, onClose, blockEscape]);
  return { mounted, shown };
}

const Spinner = ({ light, className }: { light?: boolean; className?: string }) =>
  <span className={`${st.spinner} ${light ? st.spinnerLight : ''} ${className ?? ''}`} />;

export default function YouTubeLiveSheet({ visible, session, getPayload, onClose, onConnectPhone, streamerName }: {
  visible: boolean; session: LiveSession; getPayload: () => LivePayload; onClose: () => void;
  onConnectPhone: () => void; streamerName?: string | null;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [serverModal, setServerModal] = useState(false);
  // Built-in web camera: any phone/laptop scans the QR and streams from its browser
  const [cam, setCam] = useState<{ studioUrl: string; watchUrl: string } | null>(null);
  const [camLoading, setCamLoading] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const [qrFor, setQrFor] = useState<'studio' | 'watch'>('studio');
  const { mounted, shown } = useSheet(visible, onClose, serverModal);

  // The camera page (/go) built into this server: score on the video, recording, and YouTube Live
  // with just a stream key. (The separate camera studio app isn't kept up to date on the server.)
  const loadCamera = () => {
    setCamLoading(true);
    setCamError(null);
    createCameraStream(session)
      .then(l => { setCam({ studioUrl: l.broadcastUrl, watchUrl: l.watchUrl }); setQrFor('studio'); })
      .catch((e: any) => setCamError(e.message))
      .finally(() => setCamLoading(false));
  };

  const shareWatch = () => {
    if (cam) shareText(`Watch the match live: ${cam.watchUrl}`, cam.watchUrl).catch(() => {});
  };

  const loadLink = () => {
    setUrl(null);
    setError(null);
    getOverlayLink(session, getPayload()).then(setUrl).catch((e: any) => setError(e.message));
  };

  useEffect(() => {
    if (visible) loadLink();
    else { setCam(null); setCamError(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, session.code]);

  const shareLink = () => {
    if (url) shareText(url, url).catch(() => {});
  };

  const openStudio = () => {
    try {
      openUrl('https://studio.youtube.com');
    } catch {
      popup.alert('Could Not Open YouTube', 'Open YouTube Studio manually to start your live stream.', undefined, 'error');
    }
  };

  if (!mounted || typeof document === 'undefined') return null;
  return (
    <>
      {createPortal(
        <div className={`${st.overlay} ${shown ? st.shown : ''}`} role="dialog" aria-modal="true">
          <div className={st.backdrop} onClick={onClose} />
          <div className={st.sheet}>
            <div className={st.handle} />
            <div className={st.scroll}>
              <div className={st.titleRow}>
                <div className={st.ytLogo}><span className={st.ytLogoText}>▶</span></div>
                <div className={st.flex1}>
                  <span className={st.title}>Stream on YouTube Live</span>
                  <span className={st.sub}>Live scoreboard overlay for your stream</span>
                </div>
              </div>

              {/* Any device as the camera, straight from its browser: score drawn on the video, replays,
                  full match video saved after the match */}
              <div className={st.camBox}>
                <span className={st.phoneTitle}>🎥 Stream from any device (no app needed)</span>
                {cam ? (
                  <>
                    <div className={st.tabs}>
                      <button type="button" className={`${st.tab} ${qrFor === 'studio' ? st.tabOn : ''}`} onClick={() => setQrFor('studio')}>
                        <span className={`${st.tabText} ${qrFor === 'studio' ? st.tabTextOn : ''}`}>Camera</span>
                      </button>
                      <button type="button" className={`${st.tab} ${qrFor === 'watch' ? st.tabOn : ''}`} onClick={() => setQrFor('watch')}>
                        <span className={`${st.tabText} ${qrFor === 'watch' ? st.tabTextOn : ''}`}>Viewers</span>
                      </button>
                    </div>
                    <div className={st.qrWrap}>
                      <QRCode value={qrFor === 'studio' ? cam.studioUrl : cam.watchUrl} size={210} />
                    </div>
                    <span className={st.phoneText}>
                      {qrFor === 'studio'
                        ? 'Scan with the camera phone. The camera opens in its browser. Tap the red ▶ there, paste your YouTube stream key, then tap GO LIVE: it streams to YouTube with the live score. You keep scoring here.'
                        : 'Anyone can scan this or open the link to watch live in the browser.'}
                    </span>
                    <span className={st.camLink}>{cam.watchUrl}</span>
                    <div className={st.errBtns}>
                      <button type="button" className={`${st.btn} ${st.btnDarkGhost}`} onClick={loadCamera}>
                        <span className={st.btnPrimaryText}>New QR</span>
                      </button>
                      <button type="button" className={`${st.btn} ${st.btnPrimary}`} onClick={shareWatch}>
                        <span className={st.btnPrimaryText}>Share Watch Link</span>
                      </button>
                    </div>
                    {isLocalAddress(cam.studioUrl) && (
                      <span className={st.camWarn}>
                        ⚠️ Browsers only allow the camera over https. Start the server with go-live.sh and use its https address (⚙️ on Home).
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className={st.phoneText}>
                      Show a QR code. The phone that scans it becomes the camera in its web browser and can go live on YouTube with the live score on the video (only your YouTube stream key is needed). It can also record the match and replay balls.
                    </span>
                    {camError && <span className={st.camErr}>⛔ {camError}</span>}
                    <button type="button" className={`${st.btn} ${st.btnDark} ${camLoading ? st.btnDisabled : ''}`} onClick={loadCamera} disabled={camLoading}>
                      {camLoading ? <Spinner light /> : <span className={st.btnPrimaryText}>Show Camera QR</span>}
                    </button>
                  </>
                )}
              </div>

              <ReplayControls session={session} dark={false} />

              {/* Two-device setup: this phone scores, a second phone films and streams */}
              <div className={st.phoneBox}>
                <span className={st.phoneTitle}>📱 Use a second phone as the camera</span>
                {streamerName ? (
                  <span className={st.phoneOk}>✅ Stream phone connected: {streamerName}</span>
                ) : (
                  <>
                    <span className={st.phoneText}>Keep scoring here. The second phone scans a QR, shows the live score in real time and streams to YouTube.</span>
                    <button type="button" className={`${st.btn} ${st.btnDark}`} onClick={onConnectPhone}>
                      <span className={st.btnPrimaryText}>Connect Stream Phone</span>
                    </button>
                  </>
                )}
              </div>

              <div className={st.linkBox}>
                <span className={st.linkLabel}>OVERLAY LINK · MATCH {session.code}</span>
                {url ? (
                  <span className={st.link}>{url}</span>
                ) : error ? (
                  <span className={st.errorText}>⛔ {error}</span>
                ) : (
                  <Spinner className={st.loader} />
                )}
                <div className={st.linkBtns}>
                  {error ? (
                    <div className={st.errBtns}>
                      <button type="button" className={`${st.btn} ${st.btnGhost}`} onClick={() => setServerModal(true)}>
                        <span className={st.btnGhostText}>Server Address</span>
                      </button>
                      <button type="button" className={`${st.btn} ${st.btnPrimary}`} onClick={loadLink}>
                        <span className={st.btnPrimaryText}>Retry</span>
                      </button>
                    </div>
                  ) : (
                    <button type="button" className={`${st.btn} ${st.btnPrimary} ${!url ? st.btnDisabled : ''}`} onClick={shareLink} disabled={!url}>
                      <span className={st.btnPrimaryText}>Share / Copy Link</span>
                    </button>
                  )}
                </div>
              </div>

              {!!url && isLocalAddress(url) && (
                <div className={st.warn}>
                  <span className={st.warnText}>
                    ⚠️ The CricScore server is on your local network. The streaming app must be on the same Wi-Fi as the server computer. To stream from anywhere (e.g. mobile data at the ground), host the server online and enter its address under Server Address (⚙️ on the Home screen).
                  </span>
                </div>
              )}

              {STEPS.map((s, i) => (
                <div key={i} className={st.step}>
                  <div className={st.stepNum}><span className={st.stepNumText}>{i + 1}</span></div>
                  <div className={st.flex1}>
                    <span className={st.stepTitle}>{s.title}</span>
                    <span className={st.stepBody}>{s.body}</span>
                  </div>
                </div>
              ))}

              <div className={st.preview}>
                <span className={st.previewLabel}>The overlay shows</span>
                <span className={st.previewBody}>
                  Score, overs, batters on strike, bowler figures, this over, run rate, &quot;Need X runs in Y balls&quot; in the chase, plus FOUR / SIX / WICKET animations.
                </span>
              </div>

              <button type="button" className={`${st.btn} ${st.btnYt}`} onClick={openStudio}>
                <span className={st.btnPrimaryText}>Open YouTube Studio</span>
              </button>
              <button type="button" className={st.closeBtn} onClick={onClose}>
                <span className={st.closeText}>← Back to match</span>
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      <ServerSettings visible={serverModal} onClose={() => { setServerModal(false); loadLink(); }} />
    </>
  );
}
