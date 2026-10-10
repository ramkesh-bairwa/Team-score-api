'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';

type WebkitVideo = HTMLVideoElement & { webkitEnterFullscreen?: () => void };
type LockableOrientation = ScreenOrientation & {
  lock?: (o: 'landscape' | 'portrait') => Promise<void>;
  unlock?: () => void;
};

// On phones, turn the screen to match the picture (Android Chrome; other browsers ignore it)
function lockOrientation(aspect: number | undefined) {
  if (aspect == null) return;
  const o = screen.orientation as LockableOrientation | undefined;
  o?.lock?.(aspect < 1 ? 'portrait' : 'landscape')?.catch(() => {});
}

function unlockOrientation() {
  try {
    (screen.orientation as LockableOrientation | undefined)?.unlock?.();
  } catch {}
}

export function useFullscreen(
  container: RefObject<HTMLElement | null>,
  video: RefObject<HTMLVideoElement | null>,
  // Width / height of the picture, so fullscreen on a phone turns the screen the right way
  aspect?: number,
) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      if (!document.fullscreenElement) unlockOrientation();
    };
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggle = useCallback(async () => {
    if (document.fullscreenElement) return document.exitFullscreen();
    const el = container.current;
    if (el?.requestFullscreen) {
      return el
        .requestFullscreen()
        .then(() => lockOrientation(aspect))
        .catch(() => {});
    }
    // iOS Safari only supports fullscreen on the <video> element itself
    (video.current as WebkitVideo | null)?.webkitEnterFullscreen?.();
  }, [container, video, aspect]);

  return { isFullscreen, toggle };
}
