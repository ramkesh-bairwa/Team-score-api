'use client';

import { useEffect, useState } from 'react';
import { withBase } from '@/lib/paths';

type Info = { configured: boolean; channelTitle: string | null };
type Device = { userCode: string; verificationUrl: string; expiresIn: number; interval: number };

// Connect a YouTube channel with Google's device sign-in: open google.com/device, enter the code
export default function YouTubeConnect({ info, onChange }: { info: Info; onChange: () => void }) {
  const [device, setDevice] = useState<Device | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!device) return;
    let alive = true;
    const t = setInterval(async () => {
      const res = await fetch(withBase('/api/youtube/device/poll'), { method: 'POST' }).catch(() => null);
      const data = res ? await res.json().catch(() => null) : null;
      if (!alive || !data) return;
      if (data.status === 'connected') {
        setDevice(null);
        onChange();
      } else if (data.status !== 'pending') {
        setDevice(null);
        setError(
          data.status === 'denied'
            ? 'Access was denied on the Google page.'
            : data.status === 'expired' || data.status === 'none'
              ? 'The code expired. Try again.'
              : data.error || 'Sign-in failed.',
        );
      }
    }, Math.max(3, device.interval) * 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [device, onChange]);

  if (!info.configured) {
    return (
      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
        YouTube upload isn’t set up on this server yet (add <code>YOUTUBE_CLIENT_ID</code> and{' '}
        <code>YOUTUBE_CLIENT_SECRET</code>). You can download the video in the meantime.
      </div>
    );
  }

  if (info.channelTitle) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-zinc-900 p-4 text-sm">
        <span>
          <span className="text-zinc-400">Uploading to </span>
          <span className="font-semibold">{info.channelTitle}</span>
        </span>
        <button
          onClick={async () => {
            await fetch(withBase('/api/youtube/account'), { method: 'DELETE' });
            onChange();
          }}
          className="text-xs text-zinc-400 underline-offset-4 hover:text-white hover:underline"
        >
          Use a different channel
        </button>
      </div>
    );
  }

  const start = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(withBase('/api/youtube/device'), { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not start Google sign-in');
      setDevice(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-zinc-900 p-4">
      <p className="font-semibold">Connect your YouTube channel</p>
      {device ? (
        <div className="mt-3 space-y-3">
          <p className="text-sm text-zinc-400">
            1. Open{' '}
            <a href={device.verificationUrl} target="_blank" rel="noreferrer" className="font-semibold text-white underline">
              {device.verificationUrl.replace(/^https?:\/\//, '')}
            </a>{' '}
            on this or any device. 2. Enter this code and allow access:
          </p>
          <div className="flex items-center gap-3">
            <span className="rounded-lg bg-zinc-950 px-4 py-2 font-mono text-2xl font-bold tracking-widest">{device.userCode}</span>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(device.userCode).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-xs text-zinc-500">Waiting for you to finish on Google… this updates by itself.</p>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-zinc-400">Sign in with Google once, then upload recordings with one tap.</p>
          <button
            onClick={start}
            disabled={pending}
            className="mt-3 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-zinc-900 hover:bg-zinc-200 disabled:opacity-50"
          >
            {pending ? 'Starting…' : 'Connect YouTube'}
          </button>
        </>
      )}
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  );
}
