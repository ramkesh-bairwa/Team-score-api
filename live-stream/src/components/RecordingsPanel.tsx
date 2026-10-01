'use client';

import { useCallback, useEffect, useState } from 'react';
import { withBase } from '@/lib/paths';
import type { ClientRecording } from '@/lib/recordings';
import YouTubeConnect from './YouTubeConnect';
import { Spinner, StatusPill } from './ui';

interface Props {
  roomId: string;
  title: string;
}

type YouTubeInfo = { configured: boolean; channelTitle: string | null };

const formatBytes = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.ceil(n / 1e3)} KB`;

// After the stream: list recorded segments, download them, or upload them to YouTube
export default function RecordingsPanel({ roomId, title }: Props) {
  const [recordings, setRecordings] = useState<ClientRecording[] | null>(null);
  const [youtube, setYoutube] = useState<YouTubeInfo>({ configured: false, channelTitle: null });
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(withBase(`/api/rooms/${roomId}/recordings`), { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load recordings');
      setRecordings(data.recordings);
      setYoutube(data.youtube);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [roomId]);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while anything is still being written or uploaded
  const busy = recordings?.some((r) => r.status === 'RECORDING' || r.status === 'UPLOADING');
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [busy, load]);

  if (error) return <p className="text-sm text-red-300">{error}</p>;
  if (!recordings) {
    return (
      <div className="flex items-center gap-3 text-sm text-zinc-400">
        <Spinner className="h-5 w-5" /> Loading recordings…
      </div>
    );
  }
  if (!recordings.length) {
    return <p className="text-sm text-zinc-400">This stream wasn’t recorded, so there’s nothing to upload.</p>;
  }

  return (
    <div className="space-y-4 text-left">
      <YouTubeConnect info={youtube} onChange={load} />
      <ul className="space-y-3">
        {recordings.map((rec) => (
          <RecordingItem
            key={rec.id}
            rec={rec}
            defaultTitle={recordings.length > 1 ? `${title} (part ${rec.segment})` : title}
            canUpload={youtube.configured && !!youtube.channelTitle}
            onChange={load}
          />
        ))}
      </ul>
    </div>
  );
}

function RecordingItem({
  rec,
  defaultTitle,
  canUpload,
  onChange,
}: {
  rec: ClientRecording;
  defaultTitle: string;
  canUpload: boolean;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [videoTitle, setVideoTitle] = useState(defaultTitle.slice(0, 100));
  const [privacy, setPrivacy] = useState<'unlisted' | 'private' | 'public'>('unlisted');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch(withBase(`/api/recordings/${rec.id}/youtube`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: videoTitle, privacy }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload could not start');
      setOpen(false);
      onChange();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  };

  const uploadable = rec.status === 'READY' || rec.status === 'FAILED';

  return (
    <li className="rounded-xl border border-white/10 bg-zinc-900 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Recording · part {rec.segment}</p>
          <p className="text-xs text-zinc-500">
            {formatBytes(rec.sizeBytes)} · {rec.mimeType.replace('video/', '').toUpperCase()}
          </p>
        </div>
        <RecordingStatus rec={rec} />
      </div>

      {rec.status === 'UPLOADING' && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-red-500 transition-all" style={{ width: `${rec.uploadProgress}%` }} />
        </div>
      )}
      {rec.status === 'UPLOADED' && rec.youtubeVideoId && (
        <a
          href={`https://youtu.be/${rec.youtubeVideoId}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-sm font-semibold text-red-400 underline-offset-4 hover:underline"
        >
          Watch on YouTube →
        </a>
      )}
      {rec.status === 'FAILED' && rec.uploadError && <p className="mt-2 text-sm text-red-300">{rec.uploadError}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {rec.status !== 'RECORDING' && rec.sizeBytes > 0 && (
          <a
            href={withBase(`/api/recordings/${rec.id}/file`)}
            className="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20"
          >
            Download
          </a>
        )}
        {uploadable && rec.sizeBytes > 0 && !open && (
          <button
            onClick={() => setOpen(true)}
            disabled={!canUpload}
            title={canUpload ? undefined : 'Connect a YouTube channel first'}
            className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold hover:bg-red-500 disabled:opacity-40"
          >
            {rec.status === 'FAILED' ? 'Retry YouTube upload' : 'Upload to YouTube'}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-4 space-y-3 rounded-lg bg-zinc-950 p-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">Video title</span>
            <input
              value={videoTitle}
              maxLength={100}
              onChange={(e) => setVideoTitle(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-red-500"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-400">Visibility</span>
            <select
              value={privacy}
              onChange={(e) => setPrivacy(e.target.value as typeof privacy)}
              className="w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-red-500"
            >
              <option value="unlisted">Unlisted (anyone with the link)</option>
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
          </label>
          {error && <p className="text-sm text-red-300">{error}</p>}
          <div className="flex gap-2">
            <button
              onClick={upload}
              disabled={pending || !videoTitle.trim()}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold hover:bg-red-500 disabled:opacity-50"
            >
              {pending ? 'Starting…' : 'Upload'}
            </button>
            <button onClick={() => setOpen(false)} className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:bg-white/10">
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function RecordingStatus({ rec }: { rec: ClientRecording }) {
  switch (rec.status) {
    case 'RECORDING':
      return <StatusPill tone="yellow">Saving…</StatusPill>;
    case 'READY':
      return <StatusPill tone="gray">Ready</StatusPill>;
    case 'UPLOADING':
      return <StatusPill tone="yellow">Uploading {rec.uploadProgress}%</StatusPill>;
    case 'UPLOADED':
      return <StatusPill tone="green">On YouTube</StatusPill>;
    case 'FAILED':
      return <StatusPill tone="red">Upload failed</StatusPill>;
  }
}
