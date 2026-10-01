'use client';

import Link from 'next/link';
import { useCallback, useRef, useState } from 'react';
import { useFullscreen } from '@/hooks/useFullscreen';
import { useViewer, type ViewerStatus } from '@/hooks/useViewer';
import type { RoomStatus } from '@/types/socket';
import { FullscreenIcon } from './BroadcasterView';
import VideoSurface from './VideoSurface';
import { LiveBadge, Spinner, StatusPill, ViewerCount } from './ui';

interface Props {
  roomId: string;
  title: string;
  description: string | null;
  broadcasterName: string;
  initialStatus: RoomStatus;
}

const overlayText: Partial<Record<ViewerStatus, string>> = {
  connecting: 'Connecting…',
  waiting: 'The stream hasn’t started yet. It will appear here automatically.',
  paused: 'The broadcaster paused the stream. Stay tuned.',
  negotiating: 'Joining the live stream…',
  reconnecting: 'Connection lost. Reconnecting…',
  'broadcaster-away': 'The broadcaster lost connection. Waiting for them to come back…',
};

export default function ViewerView({ roomId, title, description, broadcasterName, initialStatus }: Props) {
  const v = useViewer(roomId, initialStatus);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { isFullscreen, toggle } = useFullscreen(containerRef, videoRef);
  const [needsUnmute, setNeedsUnmute] = useState(false);
  const onAutoplayBlocked = useCallback(() => setNeedsUnmute(true), []);

  const unmute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    video.play().catch(() => {});
    setNeedsUnmute(false);
  };

  const live = v.status === 'live';
  const spinning = ['connecting', 'negotiating', 'reconnecting', 'broadcaster-away'].includes(v.status);

  return (
    <div className="mx-auto max-w-5xl px-0 py-0 sm:px-4 sm:py-6">
      <div ref={containerRef} className="relative aspect-video overflow-hidden bg-black sm:rounded-2xl sm:ring-1 sm:ring-white/10">
        <VideoSurface ref={videoRef} stream={v.remoteStream} onAutoplayBlocked={onAutoplayBlocked} />

        {v.status === 'ended' ? (
          <div className="absolute inset-0 grid place-items-center bg-zinc-950 p-6 text-center">
            <div>
              <p className="text-xl font-bold">This stream has ended</p>
              <p className="mt-1 text-sm text-zinc-400">Thanks for watching.</p>
              <Link href="/" className="mt-5 inline-block rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20">
                Browse live streams
              </Link>
            </div>
          </div>
        ) : v.status === 'error' ? (
          <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-red-300">
            {v.error ?? 'Something went wrong.'}
          </div>
        ) : (
          !live && (
            <div className="absolute inset-0 grid place-items-center bg-black/70 p-6 text-center">
              <div className="flex max-w-xs flex-col items-center gap-3 text-sm text-zinc-300">
                {spinning && <Spinner />}
                {overlayText[v.status]}
              </div>
            </div>
          )
        )}

        {live && needsUnmute && (
          <button
            onClick={unmute}
            className="absolute inset-x-0 bottom-16 mx-auto w-fit rounded-full bg-white px-4 py-2 text-sm font-semibold text-zinc-900 shadow-lg"
          >
            🔊 Tap to unmute
          </button>
        )}

        <div className="absolute left-3 top-3 flex items-center gap-2">
          {live && <LiveBadge />}
          {v.status !== 'ended' && <ViewerCount count={v.viewerCount} />}
        </div>
        <button
          onClick={toggle}
          className="absolute bottom-3 right-3 rounded-lg bg-black/60 p-2 text-white backdrop-blur hover:bg-black/80"
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
        >
          <FullscreenIcon exit={isFullscreen} />
        </button>
      </div>

      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-0">
        <div>
          <h1 className="text-xl font-bold leading-snug">{title}</h1>
          <p className="mt-0.5 text-sm text-zinc-400">{broadcasterName}</p>
          {description && <p className="mt-3 max-w-2xl text-sm text-zinc-300">{description}</p>}
        </div>
        <ConnectionStatus status={v.status} socketConnected={v.socketConnected} />
      </div>
    </div>
  );
}

function ConnectionStatus({ status, socketConnected }: { status: ViewerStatus; socketConnected: boolean }) {
  if (status === 'ended') return <StatusPill tone="gray">Ended</StatusPill>;
  if (status === 'error') return <StatusPill tone="red">Error</StatusPill>;
  if (status === 'live') return <StatusPill tone="green">Connected · real-time</StatusPill>;
  if (!socketConnected || status === 'reconnecting') return <StatusPill tone="red">Reconnecting</StatusPill>;
  if (status === 'waiting' || status === 'paused') return <StatusPill tone="yellow">Waiting for broadcaster</StatusPill>;
  return <StatusPill tone="yellow">Connecting</StatusPill>;
}
