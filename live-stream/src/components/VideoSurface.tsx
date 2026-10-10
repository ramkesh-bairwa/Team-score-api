'use client';

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

interface Props {
  stream: MediaStream | null;
  muted?: boolean;
  mirrored?: boolean;
  className?: string;
  onAutoplayBlocked?: () => void;
  // Width / height of the incoming picture; fires again when the broadcaster rotates the phone
  onAspect?: (aspect: number) => void;
}

// <video> bound to a MediaStream via srcObject (can't be set as a prop)
const VideoSurface = forwardRef<HTMLVideoElement, Props>(function VideoSurface(
  { stream, muted = false, mirrored = false, className = '', onAutoplayBlocked, onAspect },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  useImperativeHandle(ref, () => videoRef.current!);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) video.srcObject = stream;
    if (!stream) return;
    video.play().catch(() => {
      // Browsers block unmuted autoplay without a user gesture: play muted and let the user unmute
      if (!video.muted) {
        video.muted = true;
        onAutoplayBlocked?.();
        video.play().catch(() => {});
      }
    });
  }, [stream, onAutoplayBlocked]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !onAspect) return;
    const report = () => {
      if (video.videoWidth && video.videoHeight) onAspect(video.videoWidth / video.videoHeight);
    };
    report();
    video.addEventListener('loadedmetadata', report);
    video.addEventListener('resize', report);
    return () => {
      video.removeEventListener('loadedmetadata', report);
      video.removeEventListener('resize', report);
    };
  }, [onAspect]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={muted}
      className={`h-full w-full bg-black object-contain ${mirrored ? '-scale-x-100' : ''} ${className}`}
    />
  );
});

export default VideoSurface;
