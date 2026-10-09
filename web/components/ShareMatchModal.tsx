'use client';
import React, { useEffect, useState } from 'react';
import { PopupCard } from './Popup';
import QRCode from './QRCode';
import { LiveSession, JoinRole } from '@/lib/services/live';
import { getApiUrl } from '@/lib/services/server';
import { buildJoinLink } from '@/lib/utils/qrScan';
import { shareText } from '@/lib/share';
import st from './ShareMatchModal.module.css';

type Mode = 'qr' | 'code';

// Share a match two ways: a QR code (also carries the server address) or the 6-character code
export default function ShareMatchModal({ visible, session, initialRole = 'streamer', onClose }: {
  visible: boolean; session: LiveSession; initialRole?: JoinRole; onClose: () => void;
}) {
  const [mode, setMode] = useState<Mode>('qr');
  const [server, setServer] = useState('');
  const [role, setRole] = useState<JoinRole>(initialRole);

  useEffect(() => {
    if (visible) { getApiUrl().then(setServer); setRole(initialRole); }
  }, [visible, initialRole]);

  const shareCode = () => {
    shareText(`Join my CricScore match 🏏\nOpen CricScore → "Join a Match with Code" and enter: ${session.code}`).catch(() => {});
  };

  return (
    <PopupCard visible={visible} onRequestClose={onClose}>
      <span className={st.title}>Connect a Phone</span>
      <span className={st.sub}>Only one other phone can connect. It scans the QR or types the code, then you approve it.</span>

      <div className={st.roleRow}>
        {([
          { key: 'streamer', label: '📺 Live Stream' },
          { key: 'scorer', label: '🏏 Hand Over Scoring' },
        ] as const).map(r => (
          <button key={r.key} type="button" className={`${st.roleBtn} ${role === r.key ? st.roleBtnOn : ''}`} onClick={() => setRole(r.key)}>
            <span className={`${st.roleText} ${role === r.key ? st.roleTextOn : ''}`}>{r.label}</span>
          </button>
        ))}
      </div>

      <div className={st.tabs}>
        {(['qr', 'code'] as const).map(m => (
          <button key={m} type="button" className={`${st.tab} ${mode === m ? st.tabOn : ''}`} onClick={() => setMode(m)}>
            <span className={`${st.tabText} ${mode === m ? st.tabTextOn : ''}`}>{m === 'qr' ? '▦  QR Code' : '#  Code'}</span>
          </button>
        ))}
      </div>

      {mode === 'qr' ? (
        <div className={st.qrWrap}>
          {server ? <QRCode value={buildJoinLink(session.code, server, role)} size={210} /> : <div className={st.qrPlaceholder} />}
          <span className={st.hint}>On the other phone: Join a Match → 📷 Scan QR</span>
        </div>
      ) : (
        <div className={st.codeWrap}>
          <div className={st.codeBox}>
            <span className={st.code}>{session.code}</span>
          </div>
          <span className={st.hint}>On the other phone: Join a Match → enter this code → choose {role === 'streamer' ? '📺 Live Stream' : '🏏 Take Over Scoring'}</span>
          <button type="button" className={st.shareBtn} onClick={shareCode}>
            <span className={st.shareBtnText}>Share Code</span>
          </button>
        </div>
      )}

      <div className={st.note}>
        <span className={st.noteText}>
          {role === 'streamer'
            ? '📺 The stream phone shows the live score and streams to YouTube. It can never change the score.'
            : '⚠️ When they start scoring, scoring on this phone will close.'}
        </span>
      </div>

      <button type="button" className={st.doneBtn} onClick={onClose}>
        <span className={st.doneText}>Done</span>
      </button>
    </PopupCard>
  );
}
