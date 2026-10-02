'use client';

import { useEffect, useState } from 'react';
import { abbr, matchColors, teamColor } from '@/lib/compositor';
import { withBase } from '@/lib/paths';
import type { MatchResult } from '@/types/result';

// Fetches the stored result; it can take a few seconds to arrive after the last ball
export function useMatchResult(roomId: string, enabled: boolean) {
  const [result, setResult] = useState<MatchResult | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let tries = 0;
    const load = async () => {
      try {
        const res = await fetch(withBase(`/api/rooms/${roomId}/result`), { cache: 'no-store' });
        const data = res.ok ? ((await res.json()) as { result: MatchResult | null }) : null;
        if (alive && data?.result) return setResult(data.result);
      } catch {}
      if (alive && ++tries < 40) setTimeout(load, 5000);
    };
    load();
    return () => {
      alive = false;
    };
  }, [roomId, enabled]);
  return result;
}

const CONFETTI = Array.from({ length: 28 }, (_, i) => ({
  left: (i * 37) % 100,
  delay: ((i * 0.53) % 4).toFixed(2),
  dur: (3.5 + ((i * 0.71) % 3)).toFixed(2),
  color: ['#FFC531', '#ffffff', '#EF233C', '#60A5FA', '#A855F7', '#34D399'][i % 6],
  size: 6 + (i % 3) * 3,
}));

const ov = (o: number, b: number) => `${o}.${b}`;

// The "match over" screen every link of a finished match shows
export default function MatchResultCard({ result }: { result: MatchResult }) {
  const [main, dark] = teamColor(result.winner ?? result.innings[0]?.team);
  const loserTeam = result.teams.find((t) => t.name === result.loser);
  const stars = [...result.teams]
    .flatMap((t) => [
      t.bestBatter && t.bestBatter.runs > 0 && { kind: 'bat' as const, team: t.name, ...t.bestBatter },
      t.bestBowler && t.bestBowler.wickets > 0 && { kind: 'bowl' as const, team: t.name, ...t.bestBowler },
    ])
    .filter(Boolean) as (
    | ({ kind: 'bat'; team: string } & NonNullable<MatchResult['teams'][number]['bestBatter']>)
    | ({ kind: 'bowl'; team: string } & NonNullable<MatchResult['teams'][number]['bestBowler']>)
  )[];

  return (
    <section
      className="relative overflow-hidden rounded-none text-center ring-white/10 sm:rounded-2xl sm:ring-1"
      style={{
        background: `radial-gradient(120% 90% at 50% 0%, ${main} 0%, ${dark} 45%, #070d22 100%)`,
        animation: 'result-in .6s ease-out both',
      }}
    >
      {/* confetti */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        {CONFETTI.map((c, i) => (
          <span
            key={i}
            className="absolute top-0 rounded-sm"
            style={{
              left: `${c.left}%`,
              width: c.size,
              height: c.size * 0.6,
              background: c.color,
              animation: `confetti-fall ${c.dur}s ${c.delay}s linear infinite`,
            }}
          />
        ))}
      </div>

      <div className="relative px-5 pb-8 pt-10 sm:px-10">
        <p className="text-xs font-black uppercase tracking-[0.35em] text-amber-300">Match over</p>
        <div className="mt-4 text-7xl" style={{ animation: 'trophy-glow 2.4s ease-in-out infinite' }}>
          {result.tied ? '🤝' : '🏆'}
        </div>

        {result.tied ? (
          <>
            <h1 className="mt-4 text-4xl font-black uppercase tracking-tight sm:text-5xl">Match tied!</h1>
            <p className="mt-2 text-lg font-semibold text-white/80">What a game. Both teams finish level.</p>
          </>
        ) : (
          <>
            <h1 className="mt-4 text-4xl font-black uppercase leading-none tracking-tight drop-shadow sm:text-6xl">{result.winner}</h1>
            <p className="mt-3 text-lg font-bold text-amber-200 sm:text-xl">
              won the match {result.margin} 🎉
            </p>
          </>
        )}

        {/* Both innings */}
        <div className="mx-auto mt-7 grid max-w-xl gap-2">
          {result.innings.map((inn, n) => {
            const won = inn.team === result.winner;
            const [c, cd] = matchColors(result.innings[0]?.team, result.innings[1]?.team)[n] ?? teamColor(inn.team);
            return (
              <div
                key={inn.team}
                className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-left ${won ? 'bg-black/35 ring-2 ring-amber-300/80' : 'bg-black/25'}`}
              >
                <span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-black ring-2 ring-white/40"
                  style={{ background: `linear-gradient(135deg, ${c}, ${cd})` }}
                >
                  {abbr(inn.team)}
                </span>
                <span className="min-w-0 flex-1 truncate font-bold uppercase">{inn.team}</span>
                {won && <span className="rounded-md bg-amber-300 px-1.5 py-0.5 text-[10px] font-black text-zinc-900">WINNER</span>}
                <span className="text-xl font-black tabular-nums">
                  {inn.runs}/{inn.wickets}
                  <span className="ml-1 text-sm font-semibold text-white/60">({ov(inn.overs, inn.balls)})</span>
                </span>
              </div>
            );
          })}
        </div>

        {/* The other side */}
        {!result.tied && result.loser && (
          <div className="mx-auto mt-6 max-w-xl rounded-xl bg-white/10 px-4 py-3 backdrop-blur">
            <p className="text-base font-bold">👏 Well played, {result.loser}!</p>
            {loserTeam?.bestBatter && loserTeam.bestBatter.runs > 0 && (
              <p className="mt-1 text-sm text-white/75">
                {loserTeam.bestBatter.name} fought hard with {loserTeam.bestBatter.runs} ({loserTeam.bestBatter.balls})
              </p>
            )}
          </div>
        )}
        {result.tied && <p className="mt-6 text-base font-bold">👏 Well played, both teams!</p>}

        {/* Star performers */}
        {stars.length > 0 && (
          <div className="mx-auto mt-6 max-w-xl">
            <p className="mb-2 text-xs font-black uppercase tracking-[0.25em] text-white/60">Star performers</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {stars.slice(0, 4).map((p) => (
                <div key={`${p.kind}-${p.team}-${p.name}`} className="rounded-xl bg-black/30 px-3 py-2 text-left">
                  <p className="truncate text-sm font-bold">
                    {p.kind === 'bat' ? '🏏' : '🎯'} {p.name}
                  </p>
                  <p className="text-xs text-white/65">
                    {p.kind === 'bat'
                      ? `${p.runs}${p.out ? '' : '*'} (${p.balls}) · ${p.fours}×4 · ${p.sixes}×6`
                      : `${p.wickets}/${p.runs} in ${ov(p.overs, p.balls)} ov`}{' '}
                    · {abbr(p.team)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="mt-8 text-sm text-white/60">The live stream is closed. Thanks for watching! 🙏</p>
      </div>
    </section>
  );
}
