'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useBroadcaster } from '@/hooks/useBroadcaster';
import { useFullscreen } from '@/hooks/useFullscreen';
import type { RoomStatus } from '@/types/socket';
import { BallList, useHighlights } from './Highlights';
import LocalRecordingsPanel from './LocalRecordingsPanel';
import MatchResultCard, { useMatchResult } from './MatchResult';
import RecordingsPanel from './RecordingsPanel';
import ShareLink from './ShareLink';
import VideoSurface from './VideoSurface';
import { LiveBadge, Spinner, StatusPill, ViewerCount } from './ui';

interface Props {
  roomId: string;
  title: string;
  description: string | null;
  initialStatus: RoomStatus;
  hasScoreOverlay: boolean;
}

const formatMB = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

export default function BroadcasterView({ roomId, title, description, initialStatus, hasScoreOverlay }: Props) {
  const b = useBroadcaster(roomId, initialStatus, { scoreOverlay: hasScoreOverlay, title });
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { isFullscreen, toggle } = useFullscreen(containerRef, videoRef);
  // Bumped when a recording saved on the device finishes uploading, to reload the server list
  const [recordingsKey, setRecordingsKey] = useState(0);
  const result = useMatchResult(roomId, hasScoreOverlay && b.phase === 'ended');

  if (b.phase === 'ended') {
    return (
      <div className={`mx-auto px-4 text-center ${result ? 'max-w-3xl py-10' : 'max-w-lg py-16'}`}>
        {result ? (
          <MatchResultCard result={result} />
        ) : (
          <>
            <h1 className="text-2xl font-bold">Stream ended</h1>
            <p className="mt-2 text-zinc-400">“{title}” is over. Viewers have been notified.</p>
          </>
        )}
        <div className="mt-8 space-y-8">
          <LocalRecordingsPanel roomId={roomId} onUploaded={() => setRecordingsKey((k) => k + 1)} />
          <RecordingsPanel key={recordingsKey} roomId={roomId} title={title} />
        </div>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/dashboard" className="rounded-lg bg-white/10 px-4 py-2 font-semibold hover:bg-white/20">
            Dashboard
          </Link>
          <Link href="/create-live" className="rounded-lg bg-red-600 px-4 py-2 font-semibold hover:bg-red-500">
            New stream
          </Link>
        </div>
      </div>
    );
  }

  const live = b.phase === 'live';
  const canStart = !!b.localStream && b.socketStatus === 'connected' && !b.busy;

  return (
    <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1fr_320px]">
      <section>
        <div ref={containerRef} className="relative aspect-video overflow-hidden rounded-2xl bg-black ring-1 ring-white/10">
          <VideoSurface ref={videoRef} stream={b.localStream} muted />

          {!b.localStream && !b.mediaError && (
            <div className="absolute inset-0 grid place-items-center text-sm text-zinc-400">
              <div className="flex flex-col items-center gap-3">
                <Spinner /> Requesting camera & microphone…
              </div>
            </div>
          )}
          {b.mediaError && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center">
              <p className="max-w-sm text-sm text-red-300">{b.mediaError}</p>
            </div>
          )}
          {b.localStream && !b.camOn && (
            <div className="absolute inset-0 grid place-items-center bg-zinc-900 text-zinc-400">Camera is off</div>
          )}

          <div className="absolute left-3 top-3 flex items-center gap-2">
            {live ? <LiveBadge /> : <StatusPill tone="gray">Preview</StatusPill>}
            {live && <ViewerCount count={b.viewerCount} />}
            {b.replaying && <StatusPill tone="red">{b.replaying.rate < 1 ? 'Slow-mo replay on air' : 'Replay on air'}</StatusPill>}
            {b.recorder?.recording && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur">
                <span className={`h-2 w-2 rounded-full bg-red-500 ${b.recorder.paused ? '' : 'animate-pulse'}`} />
                {b.recorder.paused ? 'REC paused' : 'REC'}
              </span>
            )}
          </div>
          <button
            onClick={toggle}
            className="absolute bottom-3 right-3 rounded-lg bg-black/60 p-2 text-white backdrop-blur hover:bg-black/80"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            <FullscreenIcon exit={isFullscreen} />
          </button>
        </div>

        {b.autoEndAt && <AutoEndBanner at={b.autoEndAt} onEndNow={b.endStream} />}

        {hasScoreOverlay && <ReplayPanel b={b} live={live} roomId={roomId} />}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <ControlButton active={b.micOn} onClick={b.toggleMic} disabled={!b.localStream} label={b.micOn ? 'Mute' : 'Unmute'}>
            <MicIcon off={!b.micOn} />
          </ControlButton>
          <ControlButton active={b.camOn} onClick={b.toggleCam} disabled={!b.localStream} label={b.camOn ? 'Camera off' : 'Camera on'}>
            <CamIcon off={!b.camOn} />
          </ControlButton>
          {b.canFlip && (
            <ControlButton active onClick={b.flipCamera} disabled={!b.localStream} label={b.facing === 'user' ? 'Back camera' : 'Front camera'}>
              <FlipIcon />
            </ControlButton>
          )}

          <div className="ml-auto flex gap-2">
            {live ? (
              <button
                onClick={b.stopLive}
                disabled={b.busy}
                className="rounded-lg bg-white/10 px-4 py-2.5 text-sm font-semibold hover:bg-white/20 disabled:opacity-50"
              >
                Pause stream
              </button>
            ) : (
              <button
                onClick={b.startLive}
                disabled={!canStart}
                className="rounded-lg bg-red-600 px-5 py-2.5 text-sm font-semibold hover:bg-red-500 disabled:opacity-50"
              >
                {b.busy ? 'Starting…' : 'Go live'}
              </button>
            )}
            <button
              onClick={() => {
                if (confirm('End this stream for everyone? This cannot be undone.')) b.endStream();
              }}
              disabled={b.busy || b.socketStatus !== 'connected'}
              className="rounded-lg border border-red-500/40 px-4 py-2.5 text-sm font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50"
            >
              End stream
            </button>
          </div>
        </div>
        {!live && b.recordSupported && !b.recorder?.recording && (
          <label className="mt-3 flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={b.recordEnabled}
              onChange={(e) => b.setRecordEnabled(e.target.checked)}
              className="h-4 w-4 accent-red-600"
            />
            Record this stream (saved on this device and uploaded while there’s internet; the full match video goes
            to the server, and to YouTube if connected)
          </label>
        )}
        {b.recorder?.error && (
          <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-200 ring-1 ring-amber-500/30">
            Recording: {b.recorder.error}
          </p>
        )}
        {b.error && <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300 ring-1 ring-red-500/30">{b.error}</p>}
      </section>

      <aside className="space-y-4">
        <div className="rounded-xl border border-white/10 bg-zinc-900 p-4">
          <h1 className="text-lg font-bold leading-snug">{title}</h1>
          {description && <p className="mt-1 text-sm text-zinc-400">{description}</p>}
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <Stat label="Viewers" value={b.viewerCount} />
            <Stat label="Receiving video" value={b.connectedPeers} />
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <SignalStatus status={b.socketStatus} />
            {hasScoreOverlay && (
              <StatusPill tone={b.score && b.score.phase !== 'waiting' ? 'green' : 'yellow'}>
                {b.score && b.score.phase !== 'waiting' ? 'Scoreboard on video' : 'Waiting for score'}
              </StatusPill>
            )}
          </div>
          {b.recorder?.recording &&
            (b.recorder.online ? (
              <p className="mt-3 text-xs text-zinc-400">
                Recording on server: {formatMB(b.recorder.uploadedBytes)}
                {b.recorder.pendingChunks > 0 &&
                  ` · ${formatMB(b.recorder.savedBytes - b.recorder.uploadedBytes)} on this device, uploading`}
              </p>
            ) : (
              <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200 ring-1 ring-amber-500/30">
                No internet: recording is being saved on this device ({formatMB(b.recorder.savedBytes - b.recorder.uploadedBytes)}{' '}
                waiting). It uploads when the connection is back, or you can upload it after the match.
              </p>
            ))}
        </div>
        <ShareLink roomId={roomId} title={title} />
        <p className="px-1 text-xs leading-relaxed text-zinc-500">
          Each viewer gets a direct WebRTC connection from this device, so upload bandwidth limits how many people can
          watch smoothly (roughly 5–10 on a typical home connection).
        </p>
      </aside>
    </div>
  );
}

const REPLAYS: [string, number, number][] = [
  ['30 s', 30, 1],
  ['1 min', 60, 1],
  ['2 min', 120, 1],
  ['3 min', 180, 1],
  ['🐢 Slow-mo 10 s', 10, 0.5],
];

// Put a replay on air: the last 30 s … 3 min, or any ball of the match. Can be used again and
// again; the buffer and the ball list survive a page refresh.
function ReplayPanel({ b, live, roomId }: { b: ReturnType<typeof useBroadcaster>; live: boolean; roomId: string }) {
  const { data } = useHighlights(roomId);
  const ready = live && b.replaySupported;
  return (
    <div className="mt-4 space-y-3 rounded-xl border border-white/10 bg-zinc-900 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-1 text-sm font-semibold text-zinc-300">⏪ Replay last</span>
        {b.replaying ? (
          <button onClick={b.stopReplay} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold hover:bg-red-500">
            ■ Back to live
          </button>
        ) : (
          REPLAYS.map(([label, secs, rate]) => (
            <button
              key={label}
              onClick={() => b.startReplay(secs, rate)}
              disabled={!ready || b.replayAvailable < 3}
              className="rounded-lg bg-white/10 px-3.5 py-2 text-sm font-semibold hover:bg-white/20 disabled:opacity-40"
            >
              {label}
            </button>
          ))
        )}
      </div>
      <p className="text-xs text-zinc-500">
        {!b.replaySupported
          ? 'This browser can’t record replays.'
          : b.replaying
            ? 'Viewers see the replay now. It returns to live by itself.'
            : live
              ? `${b.replayAvailable} s of video saved for replays (up to 3 min).`
              : 'Go live to put replays on air.'}
      </p>
      <div>
        <p className="mb-2 text-sm font-semibold text-zinc-300">Ball by ball</p>
        <BallList
          balls={data?.balls ?? []}
          action="▶ On air"
          disabled={!live || !!b.replaying}
          onPlay={(ball) => ball.url && b.playClip(ball.url)}
        />
      </div>
    </div>
  );
}

// Shown once the final result is in: the stream ends by itself so the full-match video gets built
function AutoEndBanner({ at, onEndNow }: { at: number; onEndNow: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.ceil((at - now) / 1000));
  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-amber-500/10 px-4 py-3 ring-1 ring-amber-500/30">
      <p className="text-sm text-amber-100">
        <span className="font-bold">🏆 Match over.</span> Closing the stream in {left} s. Every link will then show the
        result and the full match video.
      </p>
      <div className="ml-auto flex gap-2">
        <button onClick={onEndNow} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-semibold hover:bg-red-500">
          End now
        </button>
      </div>
    </div>
  );
}

function SignalStatus({ status }: { status: 'connecting' | 'connected' | 'disconnected' }) {
  if (status === 'connected') return <StatusPill tone="green">Connected to server</StatusPill>;
  if (status === 'connecting') return <StatusPill tone="yellow">Connecting…</StatusPill>;
  return <StatusPill tone="red">Disconnected, retrying…</StatusPill>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-zinc-950 p-3">
      <dt className="text-xs text-zinc-500">{label}</dt>
      <dd className="mt-0.5 text-xl font-bold">{value}</dd>
    </div>
  );
}

function ControlButton({
  active,
  label,
  children,
  ...props
}: { active: boolean; label: string } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      aria-label={label}
      title={label}
      className={`flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold disabled:opacity-50 ${
        active ? 'bg-white/10 hover:bg-white/20' : 'bg-red-600/90 hover:bg-red-500'
      }`}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export function FullscreenIcon({ exit }: { exit: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      {exit ? (
        <path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6" />
      ) : (
        <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6" />
      )}
    </svg>
  );
}

function FlipIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M4 7h11a5 5 0 0 1 0 10H9M4 7l3-3M4 7l3 3" />
    </svg>
  );
}

function MicIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

function CamIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="M16 10l6-3v10l-6-3" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}
