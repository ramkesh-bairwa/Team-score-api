'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { getDevice } from '@/lib/device';
import { useBroadcaster } from '@/hooks/useBroadcaster';
import { useFullscreen } from '@/hooks/useFullscreen';
import type { RoomStatus } from '@/types/socket';
import { BallList, useHighlights } from './Highlights';
import LocalRecordingsPanel from './LocalRecordingsPanel';
import MatchResultCard, { useMatchResult } from './MatchResult';
import RecordingsPanel from './RecordingsPanel';
import ShareLink from './ShareLink';
import { DeviceList, REPLAYS } from './StudioDevices';
import VideoSurface from './VideoSurface';
import { Spinner, StatusPill } from './ui';

interface Props {
  roomId: string;
  title: string;
  description: string | null;
  initialStatus: RoomStatus;
  hasScoreOverlay: boolean;
  onCameraBusy?: () => void;
}

const formatMB = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

export default function BroadcasterView({ roomId, title, description, initialStatus, hasScoreOverlay, onCameraBusy }: Props) {
  const b = useBroadcaster(roomId, initialStatus, { scoreOverlay: hasScoreOverlay, title, onCameraBusy });
  const [deviceId] = useState(() => (typeof window === 'undefined' ? '' : getDevice().id));
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const { isFullscreen, toggle } = useFullscreen(containerRef, videoRef, b.aspect);
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
  const portrait = b.aspect < 1;

  return (
    <div className="mx-auto grid max-w-7xl gap-5 px-3 py-4 sm:px-4 sm:py-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="min-w-0 space-y-4">
        {/* Status bar */}
        <div className="flex flex-wrap items-center gap-2">
          {live ? (
            <span className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-black tracking-widest text-white shadow-lg shadow-red-900/40">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" /> LIVE
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-bold tracking-widest text-zinc-300">
              <span className="h-2.5 w-2.5 rounded-full bg-zinc-400" /> PREVIEW
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-sm font-semibold text-zinc-200 ring-1 ring-white/10">
            <EyeIcon /> <span className="tabular-nums">{b.viewerCount}</span>
            <span className="text-zinc-500">watching</span>
          </span>
          {b.recorder?.recording && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-sm font-semibold text-zinc-200 ring-1 ring-white/10">
              <span className={`h-2 w-2 rounded-full bg-red-500 ${b.recorder.paused ? '' : 'animate-pulse'}`} />
              {b.recorder.paused ? 'REC paused' : 'REC'}
            </span>
          )}
          {b.replaying && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-1.5 text-sm font-black tracking-wide text-amber-950">
              ⏪ {b.replaying.rate < 1 ? 'SLOW-MO REPLAY ON AIR' : 'REPLAY ON AIR'}
            </span>
          )}
          {b.lastCommand && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500/15 px-3 py-1.5 text-sm font-semibold text-sky-200 ring-1 ring-sky-500/30">
              🎛 {b.lastCommand.text}
            </span>
          )}
          <div className="ml-auto">
            <SignalStatus status={b.socketStatus} />
          </div>
        </div>

        {/* What viewers see */}
        <div
          ref={containerRef}
          style={{ aspectRatio: String(b.aspect), maxWidth: `calc((100dvh - ${portrait ? 12 : 8}rem) * ${b.aspect})` }}
          className={`relative mx-auto w-full overflow-hidden rounded-2xl bg-black [&:fullscreen]:rounded-none shadow-2xl shadow-black/60 ring-1 ring-white/10 ${
            live ? 'ring-red-500/40' : ''
          }`}
        >
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
          {/* In fullscreen the camera operator still needs the replay buttons */}
          {isFullscreen && hasScoreOverlay && live && b.replaySupported && <VideoReplayBar b={b} />}
          {isFullscreen && (
            <button
              onClick={toggle}
              className="absolute bottom-3 right-3 grid h-12 w-12 place-items-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80"
              aria-label="Exit fullscreen"
            >
              <FullscreenIcon exit />
            </button>
          )}
        </div>

        {/* Control dock */}
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-zinc-900/80 p-3">
          <div className="flex gap-2">
            <RoundButton active={b.micOn} onClick={b.toggleMic} disabled={!b.localStream} label={b.micOn ? 'Mute' : 'Unmute'}>
              <MicIcon off={!b.micOn} />
            </RoundButton>
            <RoundButton active={b.camOn} onClick={b.toggleCam} disabled={!b.localStream} label={b.camOn ? 'Camera off' : 'Camera on'}>
              <CamIcon off={!b.camOn} />
            </RoundButton>
            {b.canFlip && (
              <RoundButton active onClick={b.flipCamera} disabled={!b.localStream} label={b.facing === 'user' ? 'Use back camera' : 'Use front camera'}>
                <FlipIcon />
              </RoundButton>
            )}
            <RoundButton active onClick={toggle} label="Fullscreen">
              <FullscreenIcon exit={false} />
            </RoundButton>
          </div>
          <div className="flex min-w-[240px] flex-1 gap-2">
            {live ? (
              <button
                onClick={b.stopLive}
                disabled={b.busy}
                className="h-14 flex-1 rounded-xl bg-white/10 px-5 text-base font-bold transition hover:bg-white/20 disabled:opacity-50"
              >
                ❚❚ Pause stream
              </button>
            ) : (
              <button
                onClick={b.startLive}
                disabled={!canStart}
                className="flex h-14 flex-1 items-center justify-center gap-2.5 rounded-xl bg-gradient-to-b from-red-500 to-red-700 px-6 text-lg font-black tracking-wide text-white shadow-lg shadow-red-900/50 transition hover:from-red-400 hover:to-red-600 disabled:opacity-50 disabled:shadow-none"
              >
                <span className="h-3 w-3 rounded-full bg-white" />
                {b.busy ? 'Starting…' : 'GO LIVE'}
              </button>
            )}
            <button
              onClick={() => {
                if (confirm('End this stream for everyone? This cannot be undone.')) b.endStream();
              }}
              disabled={b.busy || b.socketStatus !== 'connected'}
              className="h-14 rounded-xl border border-red-500/40 px-4 text-sm font-bold text-red-300 transition hover:bg-red-500/10 disabled:opacity-50"
            >
              End
            </button>
          </div>
        </div>

        {!live && b.recordSupported && !b.recorder?.recording && (
          <label className="flex items-start gap-3 rounded-xl bg-white/5 px-4 py-3 text-sm text-zinc-300 ring-1 ring-white/10">
            <input
              type="checkbox"
              checked={b.recordEnabled}
              onChange={(e) => b.setRecordEnabled(e.target.checked)}
              className="mt-0.5 h-5 w-5 shrink-0 accent-red-600"
            />
            <span>
              <span className="font-semibold text-zinc-100">Record this stream.</span> Saved on this device and uploaded while
              there’s internet; the full match video goes to the server, and to YouTube if connected.
            </span>
          </label>
        )}
        {b.autoEndAt && <AutoEndBanner at={b.autoEndAt} onEndNow={b.endStream} />}
        {b.recorder?.error && (
          <p className="rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-200 ring-1 ring-amber-500/30">Recording: {b.recorder.error}</p>
        )}
        {b.error && <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300 ring-1 ring-red-500/30">{b.error}</p>}

        {hasScoreOverlay && <ReplayPanel b={b} live={live} roomId={roomId} />}
      </section>

      <aside className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-zinc-900/80 p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">Camera studio</p>
          <h1 className="mt-1 text-lg font-bold leading-snug">{title}</h1>
          {description && <p className="mt-1 text-sm text-zinc-400">{description}</p>}
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <Stat label="Viewers" value={b.viewerCount} />
            <Stat label="Receiving video" value={b.connectedPeers} />
          </dl>
          {hasScoreOverlay && (
            <div className="mt-3">
              <StatusPill tone={b.score && b.score.phase !== 'waiting' ? 'green' : 'yellow'}>
                {b.score && b.score.phase !== 'waiting' ? 'Scoreboard on video' : 'Waiting for score'}
              </StatusPill>
            </div>
          )}
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
        {b.studio && <DeviceList devices={b.studio.devices} selfId={deviceId} onRename={b.renameDevice} />}
        <ShareLink roomId={roomId} title={title} />
        <p className="px-1 text-xs leading-relaxed text-zinc-500">
          Each viewer gets a direct WebRTC connection from this device, so upload bandwidth limits how many people can
          watch smoothly (roughly 5–10 on a typical home connection).
        </p>
      </aside>
    </div>
  );
}

// Replay buttons over the picture in fullscreen, so the camera operator can fire a replay while filming
function VideoReplayBar({ b }: { b: ReturnType<typeof useBroadcaster> }) {
  return (
    <div className="absolute inset-x-0 top-3 flex flex-wrap items-center justify-center gap-2 px-3">
      {b.replaying ? (
        <button onClick={b.stopReplay} className="h-12 rounded-full bg-red-600 px-5 text-base font-black text-white shadow-lg hover:bg-red-500">
          ■ Back to live
        </button>
      ) : (
        REPLAYS.map((r) => (
          <button
            key={r.label}
            onClick={() => b.startReplay(r.secs, r.rate)}
            disabled={b.replayAvailable < 3}
            className="h-12 min-w-12 rounded-full bg-black/60 px-4 text-base font-bold text-white backdrop-blur hover:bg-red-600 disabled:opacity-40"
          >
            ⏪ {r.short}
          </button>
        ))
      )}
    </div>
  );
}

// Put a replay on air: the last 30 s … 3 min, or any ball of the match. Can be used again and
// again; the buffer and the ball list survive a page refresh.
function ReplayPanel({ b, live, roomId }: { b: ReturnType<typeof useBroadcaster>; live: boolean; roomId: string }) {
  const { data } = useHighlights(roomId);
  const ready = live && b.replaySupported && b.replayAvailable >= 3;
  return (
    <div className="space-y-4 rounded-2xl border border-white/10 bg-zinc-900/80 p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">Instant replay</h2>
          <p className="text-xs text-zinc-500">
            {!b.replaySupported
              ? 'This browser can’t record replays.'
              : b.replaying
                ? 'Viewers see the replay now. It returns to live by itself.'
                : live
                  ? 'Puts the last moments on air with the live scoreboard on top.'
                  : 'Go live to put replays on air.'}
          </p>
        </div>
        {live && b.replaySupported && (
          <div className="w-40">
            <div className="flex justify-between text-[11px] font-semibold text-zinc-400">
              <span>Buffer</span>
              <span className="tabular-nums">{b.replayAvailable} s / 3 min</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${(b.replayAvailable / 180) * 100}%` }} />
            </div>
          </div>
        )}
      </div>

      {b.replaying ? (
        <div className="space-y-3 rounded-xl bg-amber-400/10 p-3 ring-1 ring-amber-400/30">
          <div className="flex items-center gap-3">
            <span className="rounded-md bg-red-600 px-2 py-1 text-xs font-black italic tracking-widest text-white">⏪ REPLAY</span>
            {b.replaying.rate < 1 && (
              <span className="rounded-md bg-amber-400 px-2 py-1 text-xs font-black tracking-wider text-amber-950">SLOW-MO {b.replaying.rate}×</span>
            )}
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/40">
              <div className="h-full rounded-full bg-amber-400" style={{ width: `${Math.round(b.replayProgress * 100)}%` }} />
            </div>
          </div>
          <button onClick={b.stopReplay} className="h-14 w-full rounded-xl bg-red-600 text-base font-black text-white hover:bg-red-500">
            ■ Back to live
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {REPLAYS.map((r) => (
            <button
              key={r.label}
              onClick={() => b.startReplay(r.secs, r.rate)}
              disabled={!ready}
              className={`h-14 rounded-xl px-3 text-base font-bold transition disabled:opacity-40 ${
                r.rate < 1
                  ? 'col-span-2 bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/30 hover:bg-amber-400/25 sm:col-span-1'
                  : 'bg-white/10 hover:bg-white/20'
              }`}
            >
              {r.rate < 1 ? '🐢 Slow-mo 10 s' : `⏪ ${r.label}`}
            </button>
          ))}
        </div>
      )}

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

function RoundButton({
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
      className={`grid h-14 w-14 place-items-center rounded-full transition disabled:opacity-50 ${
        active ? 'bg-white/10 text-white hover:bg-white/20' : 'bg-red-600 text-white hover:bg-red-500'
      }`}
    >
      {children}
    </button>
  );
}

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />
    </svg>
  );
}

export function FullscreenIcon({ exit }: { exit: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
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
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path d="M4 7h11a5 5 0 0 1 0 10H9M4 7l3-3M4 7l3 3" />
    </svg>
  );
}

function MicIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}

function CamIcon({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <rect x="2" y="6" width="14" height="12" rx="2" />
      <path d="M16 10l6-3v10l-6-3" />
      {off && <path d="M3 3l18 18" />}
    </svg>
  );
}
