'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  assembleFile,
  deleteLocal,
  isOnline,
  listLocal,
  uploadLocal,
  type LocalRecording,
} from '@/lib/local-recordings';
import { withBase } from '@/lib/paths';
import { StatusPill } from './ui';

interface Props {
  // Only this room's recordings (the end-of-stream screen); all of them on the dashboard
  roomId?: string;
  // Called once a recording is fully on the server, so the server recordings list can refresh
  onUploaded?: () => void;
}

type YouTubeInfo = { configured: boolean; channelTitle: string | null };
type Privacy = 'unlisted' | 'private' | 'public';

// A recording another tab is still writing to; leave it alone
const ACTIVE_MS = 15_000;

const formatBytes = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.ceil(n / 1e3)} KB`;
const dateFmt = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};
export const useOnline = () => useSyncExternalStore(subscribeOnline, isOnline, () => true);

// Recordings that couldn't be uploaded during the match (no internet) and are waiting on this
// device. Once back online they can be sent to the server, or to the server and on to YouTube.
export default function LocalRecordingsPanel({ roomId, onUploaded }: Props) {
  const [recs, setRecs] = useState<LocalRecording[]>([]);
  const online = useOnline();

  const load = useCallback(async () => {
    const all = await listLocal(roomId).catch(() => []);
    setRecs(all.filter((r) => r.closed || Date.now() - r.updatedAt > ACTIVE_MS));
  }, [roomId]);

  useEffect(() => {
    load();
    // The recorder may still be finishing its last pieces in the background
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [load]);

  if (!recs.length) return null;

  return (
    <section className="space-y-3 text-left">
      <div>
        <h2 className="font-semibold">Saved on this device</h2>
        <p className="mt-1 text-sm text-zinc-400">
          {online
            ? 'These videos were recorded without internet. Upload them now; keep this page open until it finishes.'
            : 'No internet right now. The videos are safe on this device; you can upload them once you’re back online.'}
        </p>
      </div>
      <ul className="space-y-3">
        {recs.map((rec) => (
          <LocalItem
            key={rec.localId}
            rec={rec}
            online={online}
            showRoom={!roomId}
            onChange={load}
            onUploaded={() => {
              load();
              onUploaded?.();
            }}
          />
        ))}
      </ul>
    </section>
  );
}

function LocalItem({
  rec,
  online,
  showRoom,
  onChange,
  onUploaded,
}: {
  rec: LocalRecording;
  online: boolean;
  showRoom: boolean;
  onChange: () => void;
  onUploaded: () => void;
}) {
  const [busy, setBusy] = useState<'server' | 'youtube' | 'save' | null>(null);
  const [progress, setProgress] = useState<LocalRecording>(rec);
  const [error, setError] = useState<string | null>(null);
  const [ytOpen, setYtOpen] = useState(false);
  const [youtube, setYoutube] = useState<YouTubeInfo | null>(null);
  const [videoTitle, setVideoTitle] = useState(rec.title.slice(0, 100));
  const [privacy, setPrivacy] = useState<Privacy>('unlisted');

  useEffect(() => {
    if (!busy) setProgress(rec);
  }, [rec, busy]);

  // YouTube uploads go through the server, which holds the channel connection
  useEffect(() => {
    if (!online || youtube) return;
    fetch(withBase(`/api/rooms/${rec.roomId}/recordings`), { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setYoutube(d.youtube))
      .catch(() => {});
  }, [online, youtube, rec.roomId]);
  const canYouTube = !!youtube?.configured && !!youtube.channelTitle;

  const upload = async (target: 'server' | 'youtube') => {
    setBusy(target);
    setError(null);
    try {
      const result = await uploadLocal(rec.localId, { close: true, onProgress: setProgress });
      if (result.status === 'offline') {
        throw new Error('The connection dropped. Nothing was lost; try again when you’re back online.');
      }
      if (target === 'youtube' && result.serverId) {
        const res = await fetch(withBase(`/api/recordings/${result.serverId}/youtube`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: videoTitle, privacy }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`Saved on the server, but YouTube upload could not start: ${data.error || res.status}`);
      }
      onUploaded();
    } catch (err) {
      setError((err as Error).message);
      onChange();
    } finally {
      setBusy(null);
    }
  };

  const saveToDevice = async () => {
    setBusy('save');
    setError(null);
    try {
      const blob = await assembleFile(rec.localId);
      if (!blob) throw new Error('Part of this video is already on the server, so it can’t be saved as one file here.');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${rec.title.replace(/[^\w\- ]+/g, '').trim() || 'match'}-${rec.createdAt}.${rec.mimeType.includes('mp4') ? 'mp4' : 'webm'}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!confirm('Delete this video from the device? Any part not uploaded yet will be lost.')) return;
    await deleteLocal(rec.localId);
    onChange();
  };

  const waiting = progress.savedBytes - progress.uploadedBytes;
  const pct = progress.savedBytes ? Math.round((progress.uploadedBytes / progress.savedBytes) * 100) : 0;

  return (
    <li className="rounded-xl border border-white/10 bg-zinc-900 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">📱 {showRoom ? rec.title : 'Recording on this device'}</p>
          <p className="text-xs text-zinc-500">
            {dateFmt.format(rec.createdAt)} · {formatBytes(waiting)} to upload
            {progress.uploadedBytes > 0 && ` · ${formatBytes(progress.uploadedBytes)} already on server`}
          </p>
        </div>
        {busy === 'server' || busy === 'youtube' ? (
          <StatusPill tone="yellow">Uploading {pct}%</StatusPill>
        ) : (
          <StatusPill tone={online ? 'gray' : 'red'}>{online ? 'Not uploaded' : 'Offline'}</StatusPill>
        )}
      </div>

      {(busy === 'server' || busy === 'youtube') && (
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-red-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-300">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => upload('server')}
          disabled={!online || !!busy}
          title={online ? undefined : 'Available when you’re back online'}
          className="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20 disabled:opacity-40"
        >
          {busy === 'server' ? 'Uploading…' : 'Upload to server'}
        </button>
        {!ytOpen && (
          <button
            onClick={() => setYtOpen(true)}
            disabled={!online || !!busy || !canYouTube}
            title={
              !online ? 'Available when you’re back online' : canYouTube ? undefined : 'Connect a YouTube channel first'
            }
            className="rounded-lg bg-red-600 px-3 py-2 text-sm font-semibold hover:bg-red-500 disabled:opacity-40"
          >
            Upload to YouTube
          </button>
        )}
        {progress.uploadedChunks === 0 && (
          <button
            onClick={saveToDevice}
            disabled={!!busy}
            className="rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold hover:bg-white/20 disabled:opacity-40"
          >
            {busy === 'save' ? 'Preparing…' : 'Save video file'}
          </button>
        )}
        <button
          onClick={remove}
          disabled={!!busy}
          className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:bg-white/10 disabled:opacity-40"
        >
          Delete
        </button>
      </div>
      {online && youtube?.configured && !youtube.channelTitle && (
        <p className="mt-2 text-xs text-zinc-500">
          To upload to YouTube, connect a channel in{' '}
          <Link href={`/live/${rec.roomId}`} className="underline">
            this stream’s recordings
          </Link>
          .
        </p>
      )}

      {ytOpen && (
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
              onChange={(e) => setPrivacy(e.target.value as Privacy)}
              className="w-full rounded-lg border border-white/10 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-red-500"
            >
              <option value="unlisted">Unlisted (anyone with the link)</option>
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => upload('youtube')}
              disabled={!online || !!busy || !videoTitle.trim()}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold hover:bg-red-500 disabled:opacity-50"
            >
              {busy === 'youtube' ? 'Uploading…' : 'Upload'}
            </button>
            <button
              onClick={() => setYtOpen(false)}
              disabled={!!busy}
              className="rounded-lg px-4 py-2 text-sm text-zinc-400 hover:bg-white/10"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
