'use client';

import { useState } from 'react';
import type { StudioDevice } from '@/types/socket';

export const REPLAYS: { label: string; short: string; secs: number; rate: number }[] = [
  { label: '30 s', short: '30s', secs: 30, rate: 1 },
  { label: '1 min', short: '1m', secs: 60, rate: 1 },
  { label: '2 min', short: '2m', secs: 120, rate: 1 },
  { label: '3 min', short: '3m', secs: 180, rate: 1 },
  { label: 'Slow-mo 10 s', short: '🐢 Slow-mo', secs: 10, rate: 0.5 },
];

// Every device of the studio with its number and name; this device's name can be changed here
export function DeviceList({
  devices,
  selfId,
  onRename,
}: {
  devices: StudioDevice[];
  selfId: string;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const save = () => {
    const name = draft.trim();
    if (name) onRename(name);
    setEditing(false);
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-zinc-900/80 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">Devices</p>
        <p className="text-xs text-zinc-500">{devices.filter((d) => d.online).length} connected</p>
      </div>
      <ul className="mt-3 space-y-2">
        {devices.map((d) => {
          const self = d.id === selfId;
          return (
            <li key={d.id} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${self ? 'bg-white/10' : 'bg-white/5'}`}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-zinc-800 text-base font-black tabular-nums">
                {d.number}
              </span>
              <div className="min-w-0 flex-1">
                {self && editing ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      save();
                    }}
                    className="flex gap-2"
                  >
                    <input
                      autoFocus
                      value={draft}
                      maxLength={40}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={save}
                      className="min-w-0 flex-1 rounded-md bg-zinc-950 px-2 py-1 text-sm ring-1 ring-white/20 focus:outline-none focus:ring-red-500"
                    />
                  </form>
                ) : (
                  <p className="truncate text-sm font-semibold">
                    {d.name}
                    {self && <span className="font-normal text-zinc-400"> (this device)</span>}
                  </p>
                )}
                <p className="text-xs text-zinc-500">
                  <span className={d.role === 'camera' ? 'font-semibold text-red-300' : ''}>
                    {d.role === 'camera' ? '🎥 Camera' : '🎛 Remote'}
                  </span>
                  {' · '}
                  <span className={d.online ? 'text-emerald-400' : ''}>{d.online ? 'online' : 'offline'}</span>
                </p>
              </div>
              {self && !editing && (
                <button
                  onClick={() => {
                    setDraft(d.name);
                    setEditing(true);
                  }}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-zinc-300 hover:bg-white/10"
                >
                  Rename
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-zinc-500">
        Open this page on another phone or laptop (same login) to add it as a remote. Any device can put a replay on air.
      </p>
    </div>
  );
}
