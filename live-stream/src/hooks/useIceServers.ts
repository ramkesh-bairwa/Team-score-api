'use client';

import { useEffect, useRef } from 'react';
import { withBase } from '@/lib/paths';

const FALLBACK: RTCIceServer[] = [
  { urls: process.env.NEXT_PUBLIC_STUN_SERVER || 'stun:stun.l.google.com:19302' },
];

// Returns a ref so peer connections created later always use the latest config
export function useIceServers() {
  const ref = useRef<RTCIceServer[]>(FALLBACK);
  useEffect(() => {
    let cancelled = false;
    fetch(withBase('/api/ice-servers'), { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { iceServers?: RTCIceServer[] } | null) => {
        if (!cancelled && data?.iceServers?.length) ref.current = data.iceServers;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return ref;
}
