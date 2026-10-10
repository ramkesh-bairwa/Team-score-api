'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useFullscreen } from '@/hooks/useFullscreen';
import { useRemote } from '@/hooks/useRemote';
import { useViewer } from '@/hooks/useViewer';
import type { RoomStatus } from '@/types/socket';
import { FullscreenIcon } from './BroadcasterView';
import { BallList, useHighlights } from './Highlights';
import { DeviceList, REPLAYS } from './StudioDevices';
import VideoSurface from './VideoSurface';
import { Spinner, StatusPill } from './ui';

interface Props {
  roomId: string;
  title: string;
  initialStatus: RoomStatus;
  hasScoreOverlay: boolean;
  // Only offered while no camera is connected
  onBecomeCamera: () => void;
}

// Studio on a device that isn't filming: watch what goes out, put replays on air from here
export default function RemoteView({ roomId, title, initialStatus, hasScoreOverlay, onBecomeCamera }: Props) {
  const r = useRemote(roomId);
  const v = useViewer(roomId, initialStatus);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const { isFullscreen, toggle } = useFullscreen(containerRef, videoRef, aspect);
  const { data } = useHighlights(roomId, hasScoreOverlay);

  if (r.ended || v.status === 'ended') {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Stream ended</h1>
        <p className="mt-2 text-zinc-400">“{title}” is over.</p>
        <Link href="/dashboard" className="mt-8 inline-block rounded-lg bg-white/10 px-4 py-2 font-semibold hover:bg-white/20">
          Dashboard
        </Link>
      </div>
    );
  }

  const cam = r.studio?.camera ?? null;
  const cameraDevice = r.studio?.devices.find((d) => d.role === 'camera' && d.online);
  const self = r.studio?.devices.find((d) => d.id === r.deviceId);
  const live = cam?.phase === 'live';
  const ready = live && cam.replaySupported && cam.replayAvailable >= 3;

  return (
    <div className="mx-auto grid max-w-7xl gap-5 px-3 py-4 sm:px-4 sm:py-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-bold tracking-widest text-zinc-200">
            🎛 REMOTE{self ? ` · ${self.number}` : ''}
          </span>
          {live && (
            <span className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-1.5 text-sm font-black tracking-widest text-white">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" /> LIVE
            </span>
          )}
          {cam?.replaying && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-400 px-3 py-1.5 text-sm font-black tracking-wide text-amber-950">
              ⏪ {cam.replaying.rate < 1 ? 'SLOW-MO REPLAY ON AIR' : 'REPLAY ON AIR'}
            </span>
          )}
          <div className="ml-auto">
            {!r.connected ? (
              <StatusPill tone="red">Reconnecting…</StatusPill>
            ) : cameraDevice ? (
              <StatusPill tone="green">
                Camera: {cameraDevice.number} · {cameraDevice.name}
              </StatusPill>
            ) : (
              <StatusPill tone="yellow">Camera offline</StatusPill>
            )}
          </div>
        </div>

        {/* What viewers see */}
        <div
          ref={containerRef}
          style={{ aspectRatio: String(aspect), maxWidth: `calc((100dvh - 9rem) * ${aspect})` }}
          className="relative mx-auto w-full overflow-hidden rounded-2xl bg-black ring-1 ring-white/10 [&:fullscreen]:rounded-none"
        >
          <VideoSurface ref={videoRef} stream={v.remoteStream} muted onAspect={setAspect} />
          {v.status !== 'live' && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-zinc-400">
              <div className="flex flex-col items-center gap-3">
                {['connecting', 'negotiating', 'reconnecting'].includes(v.status) && <Spinner />}
                {cameraDevice ? 'Waiting for the camera to go live…' : 'No camera connected yet.'}
              </div>
            </div>
          )}
          <button
            onClick={toggle}
            className="absolute bottom-2 right-2 grid h-10 w-10 place-items-center rounded-full bg-black/50 text-white opacity-70 backdrop-blur hover:bg-black/80 hover:opacity-100"
            aria-label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            <FullscreenIcon exit={isFullscreen} />
          </button>
        </div>

        {!cameraDevice && r.connected && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl bg-amber-500/10 px-4 py-3 ring-1 ring-amber-500/30">
            <p className="text-sm text-amber-100">No device is filming right now.</p>
            <button
              onClick={onBecomeCamera}
              className="ml-auto rounded-lg bg-red-600 px-4 py-2 text-sm font-bold text-white hover:bg-red-500"
            >
              🎥 Use this device as the camera
            </button>
          </div>
        )}
        {r.error && <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-300 ring-1 ring-red-500/30">{r.error}</p>}

        <div className="space-y-4 rounded-2xl border border-white/10 bg-zinc-900/80 p-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-base font-bold">Instant replay</h2>
              <p className="text-xs text-zinc-500">
                {!cameraDevice
                  ? 'Replays play on the camera device once it is connected.'
                  : !live
                    ? 'The camera has to be live to put replays on air.'
                    : !cam?.replaySupported
                      ? 'The camera’s browser can’t record replays.'
                      : 'Plays on the camera, with the live scoreboard on top.'}
              </p>
            </div>
            {live && cam?.replaySupported && (
              <div className="w-40">
                <div className="flex justify-between text-[11px] font-semibold text-zinc-400">
                  <span>Buffer</span>
                  <span className="tabular-nums">{cam.replayAvailable} s / 3 min</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${(cam.replayAvailable / 180) * 100}%` }} />
                </div>
              </div>
            )}
          </div>

          {cam?.replaying ? (
            <div className="space-y-3 rounded-xl bg-amber-400/10 p-3 ring-1 ring-amber-400/30">
              <div className="h-2 overflow-hidden rounded-full bg-black/40">
                <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${Math.round(cam.replaying.progress * 100)}%` }} />
              </div>
              <button
                onClick={() => r.send({ action: 'stop' })}
                className="h-14 w-full rounded-xl bg-red-600 text-base font-black text-white hover:bg-red-500"
              >
                ■ Back to live
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {REPLAYS.map((rp) => (
                <button
                  key={rp.label}
                  onClick={() => r.send({ action: 'start', seconds: rp.secs, rate: rp.rate })}
                  disabled={!ready}
                  className={`h-14 rounded-xl px-3 text-base font-bold transition disabled:opacity-40 ${
                    rp.rate < 1
                      ? 'col-span-2 bg-amber-400/15 text-amber-200 ring-1 ring-amber-400/30 hover:bg-amber-400/25 sm:col-span-1'
                      : 'bg-white/10 hover:bg-white/20'
                  }`}
                >
                  {rp.rate < 1 ? '🐢 Slow-mo 10 s' : `⏪ ${rp.label}`}
                </button>
              ))}
            </div>
          )}

          {hasScoreOverlay && (
            <div>
              <p className="mb-2 text-sm font-semibold text-zinc-300">Ball by ball</p>
              <BallList
                balls={data?.balls ?? []}
                action="▶ On air"
                disabled={!live}
                onPlay={(ball) => ball.url && r.send({ action: 'clip', url: ball.url })}
              />
            </div>
          )}
        </div>
      </section>

      <aside className="space-y-4">
        <div className="rounded-2xl border border-white/10 bg-zinc-900/80 p-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">Remote control</p>
          <h1 className="mt-1 text-lg font-bold leading-snug">{title}</h1>
        </div>
        {r.studio && <DeviceList devices={r.studio.devices} selfId={r.deviceId} onRename={r.rename} />}
      </aside>
    </div>
  );
}
