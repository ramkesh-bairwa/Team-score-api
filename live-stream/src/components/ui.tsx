import type { ReactNode } from 'react';

export function LiveBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md bg-red-600 px-2 py-0.5 text-xs font-bold tracking-wide text-white ${className}`}
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
      LIVE
    </span>
  );
}

export function ViewerCount({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-black/60 px-2 py-0.5 text-xs font-semibold text-white backdrop-blur">
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
        <path d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z" />
      </svg>
      {count} watching
    </span>
  );
}

const tones = {
  green: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  yellow: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  red: 'bg-red-500/15 text-red-300 ring-red-500/30',
  gray: 'bg-zinc-500/15 text-zinc-300 ring-zinc-500/30',
};

export function StatusPill({ tone, children }: { tone: keyof typeof tones; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${tones[tone]}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function RoomStatusBadge({ status }: { status: 'WAITING' | 'LIVE' | 'ENDED' }) {
  if (status === 'LIVE') return <LiveBadge />;
  return <StatusPill tone={status === 'WAITING' ? 'yellow' : 'gray'}>{status === 'WAITING' ? 'Waiting' : 'Ended'}</StatusPill>;
}

export function Spinner({ className = 'h-8 w-8' }: { className?: string }) {
  return <span className={`inline-block animate-spin rounded-full border-2 border-white/20 border-t-white ${className}`} />;
}
