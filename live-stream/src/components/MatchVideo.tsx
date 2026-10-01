'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { withBase } from '@/lib/paths';
import { Spinner } from './ui';

interface Info {
  status: 'live' | 'ready' | 'processing' | 'parts' | 'none';
  full: { url: string } | null;
  youtubeVideoId: string | null;
  parts: { id: number; url: string }[];
}

// Fills the player area once a match stream has ended: the full match video, or the recorded
// parts back to back while the server is still building it
export default function MatchVideo({ roomId, onYouTube }: { roomId: string; onYouTube?: (id: string | null) => void }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [failed, setFailed] = useState(false);
  const [part, setPart] = useState(0);
  const [mode, setMode] = useState<'full' | 'parts' | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(withBase(`/api/rooms/${roomId}/video`), { cache: 'no-store' });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as Info;
      setInfo(data);
      setFailed(false);
      onYouTube?.(data.youtubeVideoId);
    } catch {
      setFailed(true);
    }
  }, [roomId, onYouTube]);

  useEffect(() => {
    load();
  }, [load]);

  // The room may still be closing, or the full video still encoding
  const waiting = !info || info.status === 'live' || info.status === 'processing';
  useEffect(() => {
    if (!waiting && !failed) return;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [waiting, failed, load]);

  // Pick what to play once; don't yank a viewer out of the parts when the full video lands
  useEffect(() => {
    if (mode || !info) return;
    if (info.full) setMode('full');
    else if (info.parts.length) setMode('parts');
  }, [info, mode]);

  if (!info) {
    return (
      <Center>
        <Spinner />
      </Center>
    );
  }

  if (mode === 'full' && info.full) {
    return <video key="full" src={info.full.url} controls playsInline preload="metadata" className="h-full w-full bg-black" />;
  }

  if (mode === 'parts' && info.parts.length) {
    const cur = info.parts[Math.min(part, info.parts.length - 1)];
    return (
      <div className="relative h-full w-full">
        <video
          key={cur.id}
          src={cur.url}
          controls
          playsInline
          autoPlay={part > 0}
          onEnded={() => part < info.parts.length - 1 && setPart(part + 1)}
          className="h-full w-full bg-black"
        />
        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-2">
          {info.parts.length > 1 && (
            <span className="rounded-md bg-black/60 px-2 py-0.5 text-xs font-semibold backdrop-blur">
              Part {part + 1} of {info.parts.length}
            </span>
          )}
          {info.status === 'processing' && (
            <span className="rounded-md bg-black/60 px-2 py-0.5 text-xs font-semibold text-amber-200 backdrop-blur">
              Full match video is being prepared…
            </span>
          )}
        </div>
        {info.full && (
          <button
            onClick={() => setMode('full')}
            className="absolute right-3 top-3 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold hover:bg-red-500"
          >
            Full match video ready ▸
          </button>
        )}
      </div>
    );
  }

  if (info.status === 'live' || info.status === 'processing') {
    return (
      <Center>
        <Spinner />
        <p className="mt-3 text-sm text-zinc-300">The match is over. Preparing the full match video…</p>
        <p className="mt-1 text-xs text-zinc-500">This page updates by itself.</p>
      </Center>
    );
  }

  return (
    <Center>
      <p className="text-xl font-bold">This stream has ended</p>
      <p className="mt-1 text-sm text-zinc-400">Thanks for watching.</p>
      <Link href="/" className="mt-5 inline-block rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/20">
        Browse live streams
      </Link>
    </Center>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full w-full flex-col items-center justify-center bg-zinc-950 p-6 text-center">{children}</div>;
}
