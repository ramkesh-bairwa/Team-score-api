'use client';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { listTeams, SharedTeam } from '@/lib/services/teams';
import s from './TeamPicker.module.css';

// Slide-up bottom sheet shell (web version of <Modal transparent animationType="slide">).
// Tapping the dim overlay calls onOverlayPress (if given); Escape calls onRequestClose.
export function BottomSheet({ visible, onRequestClose, onOverlayPress, overlayColor, className, children }: {
  visible: boolean;
  onRequestClose?: () => void;
  onOverlayPress?: () => void;
  overlayColor?: string;
  className?: string;
  children: React.ReactNode;
}) {
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

  // Lock the page scroll behind the sheet
  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [mounted]);

  useEffect(() => {
    if (!mounted || !onRequestClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onRequestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, onRequestClose]);

  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(
    <div
      className={`${s.sheetOverlay} ${shown ? s.sheetShown : ''}`}
      style={overlayColor ? { backgroundColor: overlayColor } : undefined}
      onClick={onOverlayPress}>
      <div className={`${s.sheetBox} ${className || ''}`} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>,
    document.body,
  );
}

// Bottom sheet listing shared teams (searchable by team or player name)
export default function TeamPicker({ visible, title, excludeId, onPick, onClose }: {
  visible: boolean; title: string; excludeId?: string;
  onPick: (team: SharedTeam) => void; onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const [teams, setTeams] = useState<SharedTeam[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const reqId = useRef(0);

  const load = (q: string) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    listTeams(q)
      .then(r => { if (id === reqId.current) { setTeams(r.teams); setOffline(r.offline); } })
      .catch(e => { if (id === reqId.current) setError(e.message); })
      .finally(() => { if (id === reqId.current) setLoading(false); });
  };

  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(() => load(search), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [visible, search]);

  const list = teams.filter(t => t.id !== excludeId);

  return (
    <BottomSheet visible={visible} onRequestClose={onClose} onOverlayPress={onClose} overlayColor="#0F172A99" className={s.sheet}>
      <div className={s.handle} />
      <div className={s.title}>{title}</div>
      <input
        className={s.search}
        placeholder="🔍  Search team or player"
        value={search}
        onChange={e => setSearch(e.target.value)}
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      {offline && <div className={s.offline}>📴 Offline · showing teams saved on this phone</div>}
      {error ? (
        <div className={s.center}>
          <div className={s.error}>⛔ {error}</div>
          <button className={s.retry} onClick={() => load(search)}>Retry</button>
        </div>
      ) : loading && !teams.length ? (
        <div className={s.center}><div className={s.spinner} /></div>
      ) : (
        <div className={s.list}>
          {list.length === 0 && <div className={s.empty}>{search ? 'No teams match your search' : 'No teams created yet'}</div>}
          {list.map(item => (
            <button key={item.id} className={s.item} onClick={() => onPick(item)}>
              <div className={s.badge}><span className={s.badgeText}>{item.name.slice(0, 2).toUpperCase()}</span></div>
              <div className={s.info}>
                <div className={s.name}>
                  {item.name}{item.pending ? '  ·  Not synced' : item.mine ? '  ·  Yours' : ''}
                </div>
                <div className={s.meta}>
                  {item.players.length} players · C: {item.captain} · by {item.createdBy}
                </div>
              </div>
              <span className={s.chev}>›</span>
            </button>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}
