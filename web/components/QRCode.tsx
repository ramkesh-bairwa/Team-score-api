'use client';
import React, { useMemo } from 'react';
import qrcode from 'qrcode-generator';
import st from './QRCode.module.css';

// Pure-JS QR code drawn as an inline SVG (crisp at any size). Dark modules in a row are
// merged into runs to keep the path short.
export default function QRCode({ value, size = 220, color = '#0F172A' }: { value: string; size?: number; color?: string }) {
  const { n, d } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    const count = qr.getModuleCount();
    let path = '';
    for (let r = 0; r < count; r++) {
      let c = 0;
      while (c < count) {
        if (!qr.isDark(r, c)) { c++; continue; }
        const start = c;
        while (c < count && qr.isDark(r, c)) c++;
        path += `M${start} ${r}h${c - start}v1h-${c - start}z`;
      }
    }
    return { n: count, d: path };
  }, [value]);

  const quiet = 4; // standard quiet-zone width, in modules
  const cell = size / (n + quiet * 2);
  return (
    <div className={st.box} style={{ width: size, height: size, padding: cell * quiet }}>
      <svg
        width={n * cell}
        height={n * cell}
        viewBox={`0 0 ${n} ${n}`}
        shapeRendering="crispEdges"
        className={st.svg}
        role="img"
        aria-label="QR code"
      >
        <path d={d} fill={color} />
      </svg>
    </div>
  );
}
