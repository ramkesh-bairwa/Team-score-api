'use client';
import React, { useEffect, useRef, useState } from 'react';
import { saveInProgressMatch, upsertMatch } from '@/lib/services/api';
import { pullLiveState } from '@/lib/services/live';
import { popup } from '@/components/Popup';
import InningsScorecard from '@/components/InningsScorecard';
import CommentaryList from '@/components/CommentaryList';
import WatchLiveCard from '@/components/WatchLiveCard';
import { pickImage } from '@/lib/pickImage';
import { C } from '@/lib/theme';
import s from './ScorecardScreen.module.css';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

function BetSettlement({ resultText, battingTeam, fieldingTeam, bet, cap1PayPhoto, cap2PayPhoto, takePayPhoto }: any) {
  const isTied = resultText === 'Match Tied!';
  const winnerTeam = !isTied
    ? (resultText.startsWith(battingTeam.name) ? battingTeam : fieldingTeam)
    : null;
  const loserTeam = !isTied
    ? (winnerTeam === battingTeam ? fieldingTeam : battingTeam)
    : null;

  return (
    <div className={s.betCard}>
      <div className={s.betHeader}>
        <div className={s.betHeaderIcon}>💰</div>
        <div className={s.col}>
          <div className={s.betCardTitle}>Bet Settlement</div>
          <div className={s.betHeaderSub}>Match bet result</div>
        </div>
      </div>

      {isTied ? (
        <div className={s.resultBanner} style={{ backgroundColor: C.accentLight, borderColor: C.accent + '40' }}>
          <div className={s.resultBannerText} style={{ color: C.accent }}>🤝 Match Tied — No Winner</div>
          <div className={s.resultBannerSub} style={{ color: C.accent + 'aa' }}>Bet amount to be returned</div>
        </div>
      ) : (
        <div className={s.resultBanner} style={{ backgroundColor: C.greenLight, borderColor: C.green + '40' }}>
          <div className={s.resultBannerText} style={{ color: C.green }}>🏆 {resultText}</div>
          <div className={s.resultBannerSub} style={{ color: C.green + 'aa' }}>{winnerTeam?.name} wins ₹{bet?.amount}</div>
        </div>
      )}

      <div className={s.betAmountBox}>
        <div className={s.betAmountItem}>
          <div className={s.betAmountLabel}>Bet Amount</div>
          <div className={s.betAmountVal}>₹{bet?.amount}</div>
        </div>
        <div className={s.betDivider} />
        <div className={s.betAmountItem}>
          <div className={s.betAmountLabel}>Status</div>
          <div className={s.betStatusVal} style={{ color: isTied ? C.accent : C.green }}>
            {isTied ? 'TIED' : 'DECIDED'}
          </div>
        </div>
      </div>

      {!isTied && (
        <div className={s.teamsRow}>
          <div className={cx(s.teamBetCard, s.winnerCard)}>
            <div className={s.teamBetBadge}>🏆 WINNER</div>
            <div className={s.teamBetName}>{winnerTeam?.name}</div>
            <div className={s.teamBetCap}>{winnerTeam?.captain}</div>
            <div className={s.teamBetAmount}>+₹{bet?.amount}</div>
          </div>
          <div className={cx(s.teamBetCard, s.loserCard)}>
            <div className={s.teamBetBadge} style={{ color: C.primary }}>❌ LOSER</div>
            <div className={s.teamBetName}>{loserTeam?.name}</div>
            <div className={s.teamBetCap}>{loserTeam?.captain}</div>
            <div className={s.teamBetAmount} style={{ color: C.primary }}>-₹{bet?.amount}</div>
          </div>
        </div>
      )}

      <div className={s.betSubText}>📸 Both captains must confirm payment</div>
      <div className={s.photoRow}>
        {[
          { team: battingTeam, photo: cap1PayPhoto, num: 1 as 1 | 2 },
          { team: fieldingTeam, photo: cap2PayPhoto, num: 2 as 1 | 2 },
        ].map(({ team, photo, num }) => {
          const isWinner = team === winnerTeam;
          return (
            <div key={num} className={cx(s.photoCard, isWinner && !isTied && s.photoCardWinner)}>
              {!isTied && (
                <div className={s.photoRoleBadge} style={{ backgroundColor: isWinner ? C.greenLight : C.primaryLight }}>
                  <div className={s.photoRoleText} style={{ color: isWinner ? C.green : C.primary }}>
                    {isWinner ? '🏆 Receives' : '💸 Pays'}
                  </div>
                </div>
              )}
              <div className={s.photoCapName}>{team.captain}</div>
              <div className={s.photoTeamName}>{team.name}</div>
              {photo ? (
                <button type="button" className={s.photoBtn} onClick={() => takePayPhoto(num)}>
                  <img src={photo} className={s.payPhoto} alt="" />
                  <div className={s.retakeText}>Tap to retake</div>
                </button>
              ) : (
                <button type="button" className={s.markPaidBtn} onClick={() => takePayPhoto(num)}>
                  <div className={s.captureIcon}>📷</div>
                  <div className={s.markPaidBtnText}>Confirm</div>
                </button>
              )}
              {photo && <div className={s.paidBadge}><div className={s.paidBadgeText}>✓ CONFIRMED</div></div>}
            </div>
          );
        })}
      </div>

      {cap1PayPhoto && cap2PayPhoto && (
        <div className={s.allConfirmedBanner}>
          <div className={s.allConfirmedText}>✅ Both captains confirmed — Bet settled!</div>
        </div>
      )}
    </div>
  );
}

// "Loser to pay": the losing team covers the itemized match expenses
function LoserSettlement({ resultText, battingTeam, fieldingTeam, bet }: any) {
  const isTied = resultText === 'Match Tied!';
  const loser = isTied ? null : resultText.startsWith(battingTeam.name) ? fieldingTeam : battingTeam;
  return (
    <div className={s.expenseCard}>
      <div className={s.expenseHead}>
        <div className={s.expenseIcon}>🧾</div>
        <div className={cx(s.col, s.flex1)}>
          <div className={s.expenseTitle}>Loser to Pay</div>
          <div className={s.expenseSub}>Match expenses</div>
        </div>
        <div className={s.expenseTotal}>₹{bet.amount}</div>
      </div>
      {(bet.expenses || []).map((e: any, i: number) => (
        <div key={i} className={s.expenseRow}>
          <div className={s.expenseItem}>{e.label}</div>
          <div className={s.expenseAmt}>₹{e.amount}</div>
        </div>
      ))}
      {!!bet.note && <div className={s.expenseNote}>📝 {bet.note}</div>}
      <div className={cx(s.expenseVerdict, isTied && s.expenseVerdictTie)}>
        <div className={cx(s.expenseVerdictText, isTied && s.expenseVerdictTextTie)}>
          {isTied
            ? `🤝 Match tied: both teams share ₹${bet.amount} (₹${Math.round(bet.amount / 2)} each)`
            : `💸 ${loser.name} pays ₹${bet.amount}${loser.captain ? ` (captain ${loser.captain})` : ''}`}
        </div>
      </div>
    </div>
  );
}

export default function ScorecardScreen({ navigation, route }: any) {
  const {
    battingTeam, fieldingTeam, overs, innings1,
    isFirstInnings, liveView, innings2, matchType,
    fromHistory, bet, location, tossWinner, tossChoice,
    live, liveMirror, matchId, matchKey,
  } = route.params;
  const isFocused = true; // each page mounts fresh; polling runs while mounted
  const liveVersion = useRef(0);

  // Team that batted first is always `battingTeam` here
  const [tab, setTab] = useState<1 | 2>(innings2 ? 2 : 1);
  const [view, setView] = useState<'card' | 'log'>('card');

  let resultText = '';
  if (!isFirstInnings && innings2) {
    if (innings2.runs > innings1.runs) {
      const wl = fieldingTeam.players.length - 1 - innings2.wickets;
      resultText = `${fieldingTeam.name} won by ${wl} wicket${wl !== 1 ? 's' : ''}`;
    } else if (innings2.runs < innings1.runs) {
      const diff = innings1.runs - innings2.runs;
      resultText = `${battingTeam.name} won by ${diff} run${diff !== 1 ? 's' : ''}`;
    } else {
      resultText = 'Match Tied!';
    }
  }

  const [cap1PayPhoto, setCap1PayPhoto] = useState<string | null>(null);
  const [cap2PayPhoto, setCap2PayPhoto] = useState<string | null>(null);

  useEffect(() => {
    if (!liveView && !isFirstInnings && !fromHistory) {
      saveResult();
    }
  }, []);

  // At the innings break, co-scorers follow whoever starts the 2nd innings
  useEffect(() => {
    if (!live || !isFirstInnings || liveView || !isFocused) return;
    let stopped = false;
    const tick = async () => {
      try {
        const r = await pullLiveState(live, liveVersion.current);
        if (stopped) return;
        if (r.movedTo) {
          stopped = true;
          popup.show({
            type: 'info', icon: '📲', dismissable: false, title: 'Scoring Moved',
            message: `${r.movedTo} is now scoring this match on their phone, so scoring on this phone is closed.`,
            buttons: [{ text: 'OK', onPress: () => navigation.navigate('Home') }],
          });
          return;
        }
        if (!r.changed) return;
        liveVersion.current = r.version;
        const p = r.payload;
        if (r.fromMe || !p || p.inningsNum !== 2) return;
        if (p.phase === 'scoring') {
          navigation.navigate('Scoring', { ...p.params, savedState: p.savedState, live });
        } else {
          navigation.navigate('Scorecard', { ...p.scorecardParams, live, liveMirror: true });
        }
      } catch (_) {}
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => { stopped = true; clearInterval(id); };
  }, [isFocused]);

  // Match API: the phone that finished the match saves the result (other connected phones skip)
  const saveResult = async () => {
    if (liveMirror || !matchId) return;
    upsertMatch(matchId, matchKey, {
      team1: battingTeam, team2: fieldingTeam, overs, matchType, location, bet,
      tossWinner, tossChoice, innings1, innings2, result: resultText, status: 'completed',
    }).catch(() => {});
  };

  const takePayPhoto = (team: 1 | 2) => {
    pickImage({ camera: true, front: true, quality: 0.7 }).then(res => {
      const uri = res?.uri;
      if (!uri) return;
      if (team === 1) setCap1PayPhoto(uri);
      else setCap2PayPhoto(uri);
    }).catch(() => {});
  };

  const hasBet = bet?.type === 'paid' && bet?.amount > 0;
  const isLoserPays = bet?.type === 'loser' && bet?.amount > 0;

  const abbr = (name: string) => {
    const words = name.trim().split(/\s+/);
    return (words.length > 1 ? words.map(w => w[0]).join('') : name).slice(0, 3).toUpperCase();
  };
  const winner = resultText && resultText !== 'Match Tied!'
    ? (resultText.startsWith(battingTeam.name) ? battingTeam.name : fieldingTeam.name) : null;

  let statusLabel = 'RESULT';
  let statusLine = resultText;
  if (liveView) {
    statusLabel = 'LIVE';
    if (innings2) {
      const need = Math.max(0, innings1.runs + 1 - innings2.runs);
      const left = Math.max(0, overs * 6 - (innings2.overs * 6 + innings2.balls));
      statusLine = `${fieldingTeam.name} need ${need} run${need === 1 ? '' : 's'} in ${left} ball${left === 1 ? '' : 's'}`;
    } else {
      const b = innings1.overs * 6 + innings1.balls;
      statusLine = `${battingTeam.name} batting · CRR ${b ? ((innings1.runs / b) * 6).toFixed(2) : '0.00'}`;
    }
  } else if (isFirstInnings) {
    statusLabel = 'INNINGS BREAK';
    statusLine = `${fieldingTeam.name} need ${innings1.runs + 1} runs to win`;
  }
  const tossLine = tossWinner
    ? `${tossWinner} won the toss and chose to ${tossChoice === 'bat' ? 'bat' : 'bowl'} first`
    : '';

  const teamRows = [
    { team: battingTeam, inn: innings1, n: 1 as const },
    { team: fieldingTeam, inn: innings2, n: 2 as const },
  ];

  return (
    <div className={s.container}>
      <div className={s.header}>
        <div className={s.headerInner}>
          <button type="button" onClick={() => navigation.goBack()} className={cx(s.btnReset, s.backBtn)}>
            <span className={s.back}>←</span>
          </button>
          <div className={s.headerMid}>
            <div className={cx(s.headerTitle, s.one)}>{battingTeam.name} vs {fieldingTeam.name}</div>
            <div className={s.headerSub}>{liveView ? 'Live scorecard' : 'Scorecard'}</div>
          </div>
          <div className={s.backBtn} />
        </div>
      </div>

      <div className={s.scrollArea}>
        <div className={s.scroll}>
          <aside className={s.side}>
          {/* Match summary */}
          <div className={s.summary}>
            <div className={s.summaryTop}>
              <div className={cx(s.summaryMeta, s.one)}>
                {overs} OVERS · {matchType === 'local' ? 'LOCAL' : 'DOMESTIC'}
                {bet?.ballType ? ` · ${String(bet.ballType).toUpperCase()} BALL` : ''}
                {location ? ` · ${location.toUpperCase()}` : ''}
              </div>
              <div className={cx(s.statusPill, liveView && s.statusPillLive, statusLabel === 'INNINGS BREAK' && s.statusPillBreak)}>
                {liveView && <div className={s.liveDot} />}
                <div className={s.statusPillText}>{statusLabel}</div>
              </div>
            </div>

            {teamRows.map(({ team, inn, n }) => {
              const dim = !!winner && winner !== team.name;
              return (
                <div key={n} className={s.teamRow}>
                  <div className={cx(s.badge, n === 2 && s.badge2)}><span className={s.badgeText}>{abbr(team.name)}</span></div>
                  <div className={cx(s.teamName, s.one, dim && s.dim)}>{team.name}</div>
                  {inn ? (
                    <div className={cx(s.teamScore, dim && s.dim)}>
                      {inn.runs}/{inn.wickets}
                      <span className={s.teamOvers}>{'  '}({inn.overs}.{inn.balls})</span>
                    </div>
                  ) : (
                    <div className={s.yetToBat}>Yet to bat</div>
                  )}
                </div>
              );
            })}

            {!!statusLine && (
              <div className={cx(s.statusLine, resultText ? s.statusWin : liveView ? s.statusLive : s.statusBreak)}>
                {resultText ? '🏆 ' : ''}{statusLine}
              </div>
            )}
            {!!tossLine && <div className={s.toss}>🪙 {tossLine}</div>}
          </div>

          {/* Viewers: QR / code / link to the live watch page */}
          {!!live?.code && <WatchLiveCard code={live.code} title={`${battingTeam.name} vs ${fieldingTeam.name}`} compact />}

          {/* Live-streamed match: innings video, ball-by-ball replays and the live stream, in the app */}
          {!!live?.code && (
            <button
              type="button"
              className={cx(s.btnReset, s.videoBtn)}
              onClick={() => navigation.navigate('MatchVideo', { code: live.code, title: `${battingTeam.name} vs ${fieldingTeam.name}` })}>
              <span className={s.videoBtnIcon}>▶</span>
              <div className={cx(s.col, s.flex1)}>
                <div className={s.videoBtnTitle}>{isFirstInnings ? 'Watch the innings video' : 'Watch match videos'}</div>
                <div className={s.videoBtnSub}>Innings videos · ball-by-ball replays · full match</div>
              </div>
              <span className={s.videoBtnArrow}>›</span>
            </button>
          )}

          {/* Bet Settlement */}
          {!liveView && !isFirstInnings && hasBet && (
            <BetSettlement
              resultText={resultText}
              battingTeam={battingTeam}
              fieldingTeam={fieldingTeam}
              bet={bet}
              cap1PayPhoto={cap1PayPhoto}
              cap2PayPhoto={cap2PayPhoto}
              takePayPhoto={takePayPhoto}
            />
          )}

          {!liveView && !isFirstInnings && isLoserPays && (
            <LoserSettlement resultText={resultText} battingTeam={battingTeam} fieldingTeam={fieldingTeam} bet={bet} />
          )}

          </aside>

          <section className={s.main}>
          {/* Innings tabs */}
          <div className={s.tabs}>
            {teamRows.map(({ team, inn, n }) => (
              <button
                type="button"
                key={n}
                className={cx(s.btnReset, s.tab, tab === n && s.tabOn)}
                disabled={!inn}
                onClick={() => setTab(n)}>
                <span className={cx(s.tabTeam, tab === n && s.tabTeamOn, !inn && s.tabOff)}>{abbr(team.name)}</span>
                <span className={cx(s.tabScore, tab === n && s.tabScoreOn, !inn && s.tabOff)}>
                  {inn ? `${inn.runs}/${inn.wickets} (${inn.overs}.${inn.balls})` : 'Yet to bat'}
                </span>
              </button>
            ))}
          </div>

          <div className={s.viewRow}>
            <div className={s.inningsTitle}>
              {tab === 1 ? battingTeam.name : fieldingTeam.name} · {tab === 1 ? '1st' : '2nd'} Innings
            </div>
            <div className={s.viewToggle}>
              {(['card', 'log'] as const).map(v => (
                <button type="button" key={v} className={cx(s.btnReset, s.viewBtn, view === v && s.viewBtnOn)} onClick={() => setView(v)}>
                  <span className={cx(s.viewBtnText, view === v && s.viewBtnTextOn)}>{v === 'card' ? 'Scorecard' : 'Commentary'}</span>
                </button>
              ))}
            </div>
          </div>
          {view === 'log' ? (
            <div className={s.logCard}>
              <CommentaryList log={(tab === 1 ? innings1 : innings2)?.ballLog ?? []} />
            </div>
          ) : tab === 1 ? (
            <InningsScorecard
              inn={innings1}
              team={battingTeam}
              bowlingTeam={fieldingTeam}
              inProgress={!!liveView && !innings2}
            />
          ) : innings2 ? (
            <InningsScorecard
              inn={innings2}
              team={fieldingTeam}
              bowlingTeam={battingTeam}
              inProgress={!!liveView}
            />
          ) : null}

          {isFirstInnings && !liveView && (
            <button
              type="button"
              className={cx(s.btnReset, s.start2ndBtn)}
              onClick={() => {
                const secondInningsParams = {
                  battingTeam: fieldingTeam, fieldingTeam: battingTeam,
                  overs, matchType, location,
                  target: innings1.runs + 1, innings1,
                  originalBattingTeam: battingTeam,
                  originalFieldingTeam: fieldingTeam, bet,
                  tossWinner, tossChoice, matchId, matchKey,
                };
                saveInProgressMatch({ ...secondInningsParams, isSecondInnings: true, savedState: null, live }).catch(() => {});
                navigation.navigate('Scoring', { ...secondInningsParams, live });
              }}>
              <span className={s.start2ndBtnText}>
                🏏 Start 2nd Innings — {fieldingTeam.name} needs {innings1.runs + 1}
              </span>
            </button>
          )}

          {!liveView && !isFirstInnings && (
            <button type="button" className={cx(s.btnReset, s.newMatchBtn)} onClick={() => navigation.navigate('Home')}>
              <span className={s.newMatchBtnText}>🏠 Back to Home</span>
            </button>
          )}
          </section>
        </div>
      </div>
    </div>
  );
}
