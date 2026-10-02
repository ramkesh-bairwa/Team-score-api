'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Highlights } from '@/lib/highlights';
import { withBase } from '@/lib/paths';

export type Ball = Highlights['balls'][number];
type Innings = Highlights['innings'][number];

// Ball-by-ball replays and innings videos of a match, refreshed while the match goes on
export function useHighlights(roomId: string, enabled = true) {
  const [data, setData] = useState<Highlights | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch(withBase(`/api/rooms/${roomId}/highlights`), { cache: 'no-store' });
      if (res.ok) setData(await res.json());
    } catch {
      // keep the last list
    }
  }, [roomId]);
  useEffect(() => {
    if (!enabled) return;
    load();
    const t = setInterval(load, 8_000);
    return () => clearInterval(t);
  }, [enabled, load]);
  return { data, reload: load };
}

const chipColor = (kind: string) =>
  kind === 'W'
    ? 'bg-red-600'
    : kind === '6'
      ? 'bg-violet-600'
      : kind === '4'
        ? 'bg-blue-600'
        : kind === 'X'
          ? 'bg-orange-500'
          : 'bg-white/15';

const chipText = (b: Ball) => (b.kind === 'X' ? b.label.split(' ')[0].slice(0, 2) : b.kind === '0' ? '•' : b.kind);

export function BallList({
  balls,
  onPlay,
  action,
  disabled,
}: {
  balls: Ball[];
  onPlay: (b: Ball) => void;
  action: string;
  disabled?: boolean;
}) {
  if (!balls.length) return <p className="text-sm text-zinc-500">Replays of each ball appear here as the match goes on.</p>;
  let lastInnings = 0;
  return (
    <ul className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
      {balls.map((b) => {
        const head = b.innings !== lastInnings;
        lastInnings = b.innings;
        return (
          <li key={b.id}>
            {head && <p className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Innings {b.innings}</p>}
            <div className="flex items-center gap-3 rounded-lg bg-white/5 px-3 py-2">
              <span className={`grid h-8 min-w-8 place-items-center rounded-full px-1.5 text-xs font-black ${chipColor(b.kind)}`}>
                {chipText(b)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  <span className="text-zinc-400">{b.over}</span> · {b.label}
                </p>
                {b.caption && <p className="truncate text-xs text-zinc-500">{b.caption}</p>}
              </div>
              {b.url ? (
                <button
                  onClick={() => onPlay(b)}
                  disabled={disabled}
                  className="shrink-0 rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20 disabled:opacity-40"
                >
                  {action}
                </button>
              ) : (
                <span className="shrink-0 text-xs text-zinc-500">Preparing…</span>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function InningsList({ innings, onPlay }: { innings: Innings[]; onPlay: (v: Innings) => void }) {
  if (!innings.length) return null;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {innings.map((v) => (
        <button
          key={v.id}
          onClick={() => v.url && onPlay(v)}
          disabled={!v.url}
          className="flex items-center gap-3 rounded-xl border border-white/10 bg-zinc-900 p-3 text-left hover:bg-zinc-800 disabled:cursor-default disabled:hover:bg-zinc-900"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-600 text-lg">▶</span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold uppercase tracking-wider text-zinc-500">Innings {v.innings} video</span>
            <span className="block truncate text-sm font-semibold">{v.title}</span>
            {v.status !== 'READY' && (
              <span className="block text-xs text-amber-300">{v.status === 'FAILED' ? 'Not available' : 'Preparing…'}</span>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

// Viewer side: innings videos + ball-by-ball replays, played in a pop-up player
export default function HighlightsPanel({ roomId }: { roomId: string }) {
  const { data } = useHighlights(roomId);
  const [playing, setPlaying] = useState<{ url: string; title: string } | null>(null);
  if (!data || (!data.balls.length && !data.innings.length)) return null;

  return (
    <section className="space-y-4 px-4 pb-10 sm:px-0">
      {!!data.innings.length && (
        <div>
          <h2 className="mb-2 text-base font-bold">Innings videos</h2>
          <InningsList innings={data.innings} onPlay={(v) => setPlaying({ url: v.url!, title: v.title })} />
        </div>
      )}
      <div>
        <h2 className="mb-2 text-base font-bold">Ball-by-ball replays</h2>
        <BallList
          balls={data.balls}
          action="▶ Watch"
          onPlay={(b) => setPlaying({ url: b.url!, title: `${b.over} · ${b.label}` })}
        />
      </div>

      {playing && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 p-4" onClick={() => setPlaying(null)}>
          <div className="w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="truncate font-semibold">{playing.title}</p>
              <button onClick={() => setPlaying(null)} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/20">
                Close
              </button>
            </div>
            <video key={playing.url} src={playing.url} controls autoPlay playsInline className="aspect-video w-full rounded-xl bg-black" />
          </div>
        </div>
      )}
    </section>
  );
}
