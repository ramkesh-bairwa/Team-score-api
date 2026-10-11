'use client';
import React from 'react';
import s from './InningsScorecard.module.css';

type Ball = { runs: number; extra?: string; wicket?: boolean };
type Team = { name: string; players: string[]; captain?: string; playerDetails?: { name: string; roles?: string[] }[] };
export type Innings = {
  runs: number; wickets: number; overs: number; balls: number;
  batters: { name: string; runs: number; balls: number; fours: number; sixes: number; out: boolean; howOut?: string; retired?: 'hurt' | 'out' }[];
  bowlers: { name: string; overs: number; balls: number; runs: number; wickets: number; maidens?: number; wides?: number; noBalls?: number }[];
  overHistory?: Ball[][];
  fallOfWickets?: { score: number; wicket: number; over: string; batter: string }[];
  ballLog?: import('./CommentaryList').LogEntry[];
};

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

const sr = (r: number, b: number) => (b > 0 ? ((r / b) * 100).toFixed(1) : '-');
const econ = (r: number, o: number, b: number) => (o * 6 + b > 0 ? (r / ((o * 6 + b) / 6)).toFixed(2) : '-');

// Extras breakdown from ball history; older matches without history fall back to total minus batters' runs
function extrasOf(inn: Innings) {
  if (!inn.overHistory) {
    const bat = inn.batters.reduce((sum, b) => sum + b.runs, 0);
    return { total: Math.max(0, inn.runs - bat), detail: '' };
  }
  const all = inn.overHistory.flat();
  const sum = (t: string) => all.filter(b => b.extra === t).reduce((acc, b) => acc + b.runs, 0);
  const parts = { b: sum('b'), lb: sum('lb'), w: sum('wd'), nb: sum('nb'), db: sum('db') };
  const total = parts.b + parts.lb + parts.w + parts.nb + parts.db;
  return { total, detail: `b ${parts.b}, lb ${parts.lb}, w ${parts.w}, nb ${parts.nb}${parts.db ? `, dead ball ${parts.db}` : ''}` };
}

const roleTag = (team: Team, name: string) => {
  const tags: string[] = [];
  if (team.captain === name) tags.push('c');
  if (team.playerDetails?.find(p => p.name === name)?.roles?.includes('Keeper')) tags.push('wk');
  return tags.length ? ` (${tags.join(', ')})` : '';
};

// Cricbuzz-style innings: batting table, extras, total, did not bat, fall of wickets, bowling table
export default function InningsScorecard({ inn, team, bowlingTeam, inProgress }: {
  inn: Innings; team: Team; bowlingTeam: Team; inProgress: boolean;
}) {
  const extras = extrasOf(inn);
  const batted = new Set(inn.batters.map(b => b.name));
  const yetToBat = team.players.filter(p => !batted.has(p));
  const totalBalls = inn.overs * 6 + inn.balls;
  const rr = totalBalls > 0 ? ((inn.runs / totalBalls) * 6).toFixed(2) : '0.00';

  return (
    <div className={s.wrap}>
      {/* Batting */}
      <div className={s.table}>
        <div className={cx(s.row, s.headRow)}>
          <div className={cx(s.nameCol, s.head)}>Batter</div>
          <div className={cx(s.num, s.head)}>R</div>
          <div className={cx(s.num, s.head)}>B</div>
          <div className={cx(s.numSm, s.head)}>4s</div>
          <div className={cx(s.numSm, s.head)}>6s</div>
          <div className={cx(s.numWide, s.head)}>SR</div>
        </div>
        {inn.batters.map((b, i) => (
          <div key={`${b.name}-${i}`} className={cx(s.row, s.bodyRow)}>
            <div className={s.nameCol}>
              <div className={cx(s.player, s.one, !b.out && !b.retired && s.playerIn)}>
                {b.name}{roleTag(team, b.name)}{!b.out && !b.retired && inProgress ? ' *' : ''}
              </div>
              <div className={cx(s.dismissal, s.one, !b.out && !b.retired && s.notOut)}>
                {b.out || b.retired ? (b.howOut || 'out') : inProgress ? 'batting' : 'not out'}
              </div>
            </div>
            <div className={cx(s.num, s.runs)}>{b.runs}</div>
            <div className={s.num}>{b.balls}</div>
            <div className={s.numSm}>{b.fours}</div>
            <div className={s.numSm}>{b.sixes}</div>
            <div className={s.numWide}>{sr(b.runs, b.balls)}</div>
          </div>
        ))}

        <div className={cx(s.row, s.bodyRow)}>
          <div className={cx(s.nameCol, s.label)}>Extras</div>
          <div className={s.extrasVal}>
            <span className={s.bold}>{extras.total}</span>
            {extras.detail ? <span className={s.muted}>{'\u00A0\u00A0'}({extras.detail})</span> : null}
          </div>
        </div>
        <div className={cx(s.row, s.totalRow)}>
          <div className={cx(s.nameCol, s.totalLabel)}>Total</div>
          <div className={s.totalVal}>
            {inn.runs}
            <span className={s.totalMeta}>{'\u00A0\u00A0'}({inn.wickets} wkts, {inn.overs}.{inn.balls} Ov, RR {rr})</span>
          </div>
        </div>
        {yetToBat.length > 0 && (
          <div className={s.noteRow}>
            <div className={s.noteLabel}>{inProgress ? 'Yet to bat' : 'Did not bat'}</div>
            <div className={s.noteText}>{yetToBat.map(p => p + roleTag(team, p)).join(', ')}</div>
          </div>
        )}
      </div>

      {/* Fall of wickets */}
      {!!inn.fallOfWickets?.length && (
        <div className={s.table}>
          <div className={cx(s.row, s.headRow)}><div className={cx(s.head, s.flex)}>Fall of wickets</div></div>
          <div className={s.fowWrap}>
            {inn.fallOfWickets.map(f => (
              <div key={f.wicket} className={s.fowItem}>
                <div className={s.fowScore}>{f.score}-{f.wicket}</div>
                <div className={cx(s.fowMeta, s.one)}>{f.batter} · {f.over} ov</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bowling */}
      <div className={s.table}>
        <div className={cx(s.row, s.headRow)}>
          <div className={cx(s.nameCol, s.head)}>Bowler</div>
          <div className={cx(s.num, s.head)}>O</div>
          <div className={cx(s.numSm, s.head)}>M</div>
          <div className={cx(s.num, s.head)}>R</div>
          <div className={cx(s.numSm, s.head)}>W</div>
          <div className={cx(s.numSm, s.head)}>NB</div>
          <div className={cx(s.numSm, s.head)}>WD</div>
          <div className={cx(s.numWide, s.head)}>ECO</div>
        </div>
        {inn.bowlers.map((b, i) => (
          <div key={`${b.name}-${i}`} className={cx(s.row, s.bodyRow)}>
            <div className={cx(s.nameCol, s.player, s.one)}>{b.name}{roleTag(bowlingTeam, b.name)}</div>
            <div className={s.num}>{b.overs}.{b.balls}</div>
            <div className={s.numSm}>{b.maidens ?? 0}</div>
            <div className={s.num}>{b.runs}</div>
            <div className={cx(s.numSm, s.runs, b.wickets > 0 && s.wkts)}>{b.wickets}</div>
            <div className={s.numSm}>{b.noBalls ?? 0}</div>
            <div className={s.numSm}>{b.wides ?? 0}</div>
            <div className={s.numWide}>{econ(b.runs, b.overs, b.balls)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
