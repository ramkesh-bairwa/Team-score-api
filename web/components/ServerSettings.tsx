'use client';
import React, { useEffect, useState } from 'react';
import { PopupCard, PopupIcon } from './Popup';
import { getApiUrl, setApiUrl, normalizeApiUrl, testServer } from '@/lib/services/server';
import st from './ServerSettings.module.css';

type Status = 'idle' | 'testing' | 'ok' | 'fail';

// Lets the user point the app at the CricScore server (laptop Wi-Fi IP or a hosted URL)
export default function ServerSettings({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  useEffect(() => {
    if (!visible) return;
    setStatus('idle');
    getApiUrl().then(u => setInput(u.replace(/\/api$/, '')));
  }, [visible]);

  const test = async () => {
    setStatus('testing');
    setStatus((await testServer(normalizeApiUrl(input))) ? 'ok' : 'fail');
  };

  const save = async () => {
    setStatus('testing');
    const ok = await testServer(normalizeApiUrl(input));
    if (!ok) { setStatus('fail'); return; }
    await setApiUrl(input);
    onClose();
  };

  return (
    <PopupCard visible={visible} onRequestClose={onClose}>
      <PopupIcon type="info" icon="🖥️" />
      <span className={st.title}>Server Address</span>
      <span className={st.sub}>
        The computer running the CricScore server. On Wi-Fi, use its IP address (e.g. 192.168.1.49:3000) — both must be on the same network.
      </span>
      <input
        className={st.input}
        value={input}
        onChange={e => { setInput(e.target.value); setStatus('idle'); }}
        onKeyDown={e => { if (e.key === 'Enter') save(); }}
        placeholder="192.168.1.49:3000"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        inputMode="url"
        type="text"
      />
      <div className={st.statusRow}>
        {status === 'testing' && <span className={st.spinner} />}
        {status === 'testing' && <span className={st.hint}>Connecting… a sleeping free server can take up to a minute</span>}
        {status === 'ok' && <span className={st.statusText} style={{ color: 'var(--green)' }}>✅ Connected</span>}
        {status === 'fail' && <span className={st.statusText} style={{ color: 'var(--primary)' }}>⛔ Can&apos;t reach the server. Check the address and that the server is running.</span>}
      </div>
      <div className={st.btnRow}>
        <button type="button" className={`${st.btn} ${st.btnGhost}`} onClick={test}>
          <span className={st.btnGhostText}>Test</span>
        </button>
        <button type="button" className={`${st.btn} ${st.btnPrimary}`} onClick={save}>
          <span className={st.btnPrimaryText}>Save</span>
        </button>
      </div>
      <button type="button" className={st.cancel} onClick={onClose}>
        <span className={st.cancelText}>Cancel</span>
      </button>
    </PopupCard>
  );
}
