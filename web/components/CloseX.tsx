'use client';
import React from 'react';
import st from './CloseX.module.css';

// ✕ in the top-right corner of a popup or sheet (its box needs position: relative)
export default function CloseX({ onClick, label = 'Close' }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className={st.x} onClick={onClick} aria-label={label} title={label}>
      <span aria-hidden>✕</span>
    </button>
  );
}
