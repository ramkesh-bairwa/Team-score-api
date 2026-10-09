'use client';
// Web version of the app's Popup: same API (popup.alert / popup.show / PopupCard / PopupIcon), same look.
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { C } from '@/lib/theme';
import st from './Popup.module.css';

export type PopupType = 'info' | 'success' | 'error' | 'warning' | 'confirm' | 'danger';
export type PopupButton = { text: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void };
export type PopupOptions = {
  type?: PopupType;
  title: string;
  message?: string;
  icon?: string;
  highlight?: string;
  buttons?: PopupButton[];
  dismissable?: boolean;
};

const THEME: Record<PopupType, { icon: string; color: string; light: string }> = {
  info: { icon: 'ℹ️', color: C.accent, light: C.accentLight },
  success: { icon: '✅', color: C.green, light: C.greenLight },
  error: { icon: '⛔', color: C.primary, light: C.primaryLight },
  warning: { icon: '⚠️', color: C.orange, light: C.orangeLight },
  confirm: { icon: '❓', color: C.accent, light: C.accentLight },
  danger: { icon: '🗑️', color: C.primary, light: C.primaryLight },
};

// ─── Animated card shell, reusable for custom popups (forms etc.) ───────

export function PopupCard({ visible, onRequestClose, children, wide }: {
  visible: boolean; onRequestClose?: () => void; children: React.ReactNode; wide?: boolean;
}) {
  const [mounted, setMounted] = useState(visible);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      const t = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(t);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 170);
    return () => clearTimeout(t);
  }, [visible]);

  useEffect(() => {
    if (!mounted || !onRequestClose) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onRequestClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mounted, onRequestClose]);

  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(
    <div className={`${st.overlay} ${shown ? st.shown : ''}`} onClick={onRequestClose}>
      <div className={`${st.card} ${wide ? st.wide : ''}`} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function PopupIcon({ type = 'info', icon }: { type?: PopupType; icon?: string }) {
  const t = THEME[type];
  return (
    <div className={st.iconRing} style={{ backgroundColor: t.light, borderColor: t.color + '30' }}>
      <span className={st.iconText}>{icon || t.icon}</span>
    </div>
  );
}

// ─── Global imperative popup (drop-in replacement for alert/confirm) ──────

let hostShow: ((o: PopupOptions) => void) | null = null;
const pending: PopupOptions[] = [];

export const popup = {
  show(o: PopupOptions) {
    if (hostShow) hostShow(o);
    else pending.push(o);
  },
  alert(title: string, message?: string, buttons?: PopupButton[], type?: PopupType) {
    const inferred: PopupType = type
      ?? (buttons?.some(b => b.style === 'destructive') ? 'danger' : buttons && buttons.length > 1 ? 'confirm' : 'info');
    popup.show({ title, message, buttons, type: inferred });
  },
};

export function PopupHost() {
  const [queue, setQueue] = useState<PopupOptions[]>([]);
  const [visible, setVisible] = useState(false);
  const current = queue[0];

  useEffect(() => {
    hostShow = o => setQueue(q => [...q, o]);
    if (pending.length) setQueue(q => [...q, ...pending.splice(0)]);
    return () => { hostShow = null; };
  }, []);

  useEffect(() => {
    if (current && !visible) setVisible(true);
  }, [current, visible]);

  const close = (btn?: PopupButton) => {
    setVisible(false);
    setTimeout(() => {
      setQueue(q => q.slice(1));
      btn?.onPress?.();
    }, 170);
  };

  if (!current) return null;

  const type = current.type ?? 'info';
  const t = THEME[type];
  const raw: PopupButton[] = current.buttons?.length ? current.buttons : [{ text: 'OK' }];
  const stacked = raw.length > 2;
  const buttons = stacked ? [...raw.filter(b => b.style !== 'cancel'), ...raw.filter(b => b.style === 'cancel')] : raw;
  const cancelBtn = buttons.find(b => b.style === 'cancel');

  return (
    <PopupCard visible={visible} onRequestClose={() => { if (current.dismissable !== false) close(cancelBtn); }}>
      <PopupIcon type={type} icon={current.icon} />
      <div className={st.title}>{current.title}</div>
      {!!current.message && <div className={st.message}>{current.message}</div>}
      {!!current.highlight && (
        <div className={st.highlight} style={{ borderColor: t.color + '50', backgroundColor: t.light }}>
          <span className={st.highlightText} style={{ color: t.color }}>{current.highlight}</span>
        </div>
      )}
      <div className={`${st.btnRow} ${stacked ? st.btnCol : ''}`}>
        {buttons.map((b, i) => {
          const isCancel = b.style === 'cancel';
          const color = b.style === 'destructive' ? C.primary : t.color;
          return (
            <button
              key={i}
              className={`${st.btn} ${!stacked ? st.btnFlex : ''} ${isCancel ? st.btnCancel : ''}`}
              style={isCancel ? undefined : { backgroundColor: color }}
              onClick={() => close(b)}>
              {b.text}
            </button>
          );
        })}
      </div>
    </PopupCard>
  );
}
