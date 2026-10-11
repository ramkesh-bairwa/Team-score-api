'use client';
import React, { useEffect, useRef, useState } from 'react';
import st from './PhoneCamera.module.css';

export type CamState = 'starting' | 'live' | 'off' | 'error';

// Live camera from the scoring phone itself: the camera page (/go, embedded) runs under the score,
// so one upright phone scores and streams. Streaming, recording and YouTube Live work as on the
// camera page. The scoring screen's Go Live / Stop Live drives it: `stopping` asks the camera page
// to end the stream (and save the recording's last piece), then onStopped closes the panel.
export default function PhoneCamera({ url, watchUrl, stopping, onState, onStopped, onClose }: {
  url: string; watchUrl?: string; stopping: boolean;
  onState: (state: CamState, error?: string | null) => void;
  onStopped: () => void;
  onClose: () => void;
}) {
  // Phones start with the smaller picture, so the score, the video and the scoring pad fit together
  const [small, setSmall] = useState(() => typeof window !== 'undefined' && window.innerWidth < 1024);
  const frame = useRef<HTMLIFrameElement>(null);
  const cb = useRef({ onState, onStopped });
  cb.current = { onState, onStopped };

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || e.data?.type !== 'cricscore-cam') return;
      if (e.data.state === 'stopped') cb.current.onStopped();
      else cb.current.onState(e.data.state, e.data.error);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  useEffect(() => {
    if (!stopping) return;
    frame.current?.contentWindow?.postMessage({ type: 'cricscore-cam-stop' }, '*');
    // Close anyway if the camera page doesn't answer (e.g. it never loaded)
    const t = setTimeout(() => cb.current.onStopped(), 8000);
    return () => clearTimeout(t);
  }, [stopping]);

  return (
    <section className={st.panel} aria-label="Live camera from this phone">
      <div className={st.head}>
        <span className={st.title}><span className={st.dot} aria-hidden /> Live camera · this phone</span>
        <div className={st.actions}>
          <button type="button" className={st.btn} onClick={() => setSmall(v => !v)}>{small ? '⤢ Bigger' : '⤡ Smaller'}</button>
          <button type="button" className={st.btn} onClick={onClose} aria-label="Stop live and close the camera">✕</button>
        </div>
      </div>
      <div className={`${st.frameWrap} ${small ? st.small : ''}`}>
        <iframe
          ref={frame}
          src={url}
          className={st.frame}
          title="Live camera"
          allow="camera; microphone; autoplay; fullscreen; screen-wake-lock"
        />
      </div>
      <span className={st.hint}>
        Hold the phone upright. ⏺ records, ▶ goes live on YouTube. Keep this screen open while streaming.
        {watchUrl ? <> Viewers: <span className={st.link}>{watchUrl}</span></> : null}
      </span>
    </section>
  );
}
