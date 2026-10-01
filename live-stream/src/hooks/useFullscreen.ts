'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';

type WebkitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

export function useFullscreen(container: RefObject<HTMLElement | null>, video: RefObject<HTMLVideoElement | null>) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = useCallback(async () => {
    if (document.fullscreenElement) return document.exitFullscreen();
    const el = container.current;
    if (el?.requestFullscreen) return el.requestFullscreen().catch(() => {});
    // iOS Safari only supports fullscreen on the <video> element itself
    (video.current as WebkitVideo | null)?.webkitEnterFullscreen?.();
  }, [container, video]);

  return { isFullscreen, toggle };
}
