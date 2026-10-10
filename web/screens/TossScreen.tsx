'use client';
import React, { useEffect, useState } from 'react';
import { newMatchIdentity } from '@/lib/services/api';
import { SETUP_DRAFT, BET_DRAFT, clearDrafts } from '@/lib/screenDraft';
import s from './TossScreen.module.css';

export default function TossScreen({ navigation, route }: any) {
  const { team1, team2, overs, matchType, bet, location } = route.params || {};
  const [tossWinner, setTossWinner] = useState<null | 'team1' | 'team2'>(null);
  const [choice, setChoice] = useState<null | 'bat' | 'field'>(null);

  // Opened directly (no match params, e.g. a bookmarked URL): go Home
  const missing = !team1 || !team2;
  useEffect(() => { if (missing) navigation.replace('Home'); }, [missing, navigation]);
  if (missing) return null;

  const startMatch = () => {
    if (!tossWinner || !choice) return;
    const tossTeam = tossWinner === 'team1' ? team1 : team2;
    const otherTeam = tossWinner === 'team1' ? team2 : team1;
    const battingTeam = choice === 'bat' ? tossTeam : otherTeam;
    const fieldingTeam = choice === 'bat' ? otherTeam : tossTeam;
    clearDrafts(SETUP_DRAFT, BET_DRAFT); // the setup flow is done
    navigation.navigate('Scoring', {
      battingTeam, fieldingTeam, overs, matchType, location, bet,
      tossWinner: tossTeam.name, tossChoice: choice,
      ...newMatchIdentity(), // matchId + matchKey for the match API
    });
  };

  const winnerName = tossWinner === 'team1' ? team1.name : team2.name;
  const loserName = tossWinner === 'team1' ? team2.name : team1.name;

  return (
    <div className={s.container}>
      <header className={s.hero}>
        <div className={s.headerInner}>
          <button className={s.back} onClick={() => navigation.goBack()} aria-label="Back">
            <span aria-hidden>←</span><span className={s.backText}>Back</span>
          </button>
          <h1 className={s.headerTitle}>Toss Result</h1>
          <div className={s.headerSpacer} />
        </div>
        <div className={s.matchup}>
          <div className={`${s.matchTeam} ${tossWinner === 'team1' ? s.matchTeamWon : ''}`}>{team1.name}</div>
          <div className={s.vsDisk}>VS</div>
          <div className={`${s.matchTeam} ${tossWinner === 'team2' ? s.matchTeamWon : ''}`}>{team2.name}</div>
        </div>
        <div className={s.oversLabel}>{overs} Overs · {matchType === 'local' ? '🏘️ Local' : '🏟️ Domestic'}</div>
      </header>

      <main className={s.scroll}>
        <section className={s.panel}>
          <div className={s.sectionTitle}><span className={s.stepNum}>1</span>Who won the toss?</div>
          <div className={s.row}>
            {(['team1', 'team2'] as const).map(t => {
              const team = t === 'team1' ? team1 : team2;
              return (
                <button
                  key={t}
                  className={`${s.teamBtn} ${tossWinner === t ? s.teamBtnActive : ''}`}
                  aria-pressed={tossWinner === t}
                  onClick={() => { setTossWinner(t); setChoice(null); }}>
                  <span className={s.teamBtnIcon} aria-hidden>🪙</span>
                  <span className={`${s.teamBtnText} ${tossWinner === t ? s.teamBtnTextActive : ''}`}>{team.name}</span>
                  {tossWinner === t && <span className={s.check}>✓</span>}
                </button>
              );
            })}
          </div>
        </section>

        {tossWinner && (
          <section className={`${s.panel} ${s.panelIn}`}>
            <div className={s.sectionTitle}><span className={s.stepNum}>2</span>{winnerName} elected to...</div>
            <div className={s.row}>
              <button
                className={`${s.choiceBtn} ${choice === 'bat' ? s.choiceBtnActive : ''}`}
                aria-pressed={choice === 'bat'}
                onClick={() => setChoice('bat')}>
                <span className={s.choiceIcon} aria-hidden>🏏</span>
                <span className={`${s.choiceText} ${choice === 'bat' ? s.choiceTextActive : ''}`}>Bat First</span>
              </button>
              <button
                className={`${s.choiceBtn} ${choice === 'field' ? s.choiceBtnActive : ''}`}
                aria-pressed={choice === 'field'}
                onClick={() => setChoice('field')}>
                <span className={s.choiceIcon} aria-hidden>🎳</span>
                <span className={`${s.choiceText} ${choice === 'field' ? s.choiceTextActive : ''}`}>Bowl First</span>
              </button>
            </div>
          </section>
        )}

        {tossWinner && choice && (
          <div className={`${s.summaryBox} ${s.panelIn}`}>
            <div className={s.summaryRow}>
              <span className={s.summaryIcon}>🏏</span>
              <span><b className={s.bold}>{choice === 'bat' ? winnerName : loserName}</b> will bat first</span>
            </div>
            <div className={s.summaryRow}>
              <span className={s.summaryIcon}>🎳</span>
              <span><b className={s.bold}>{choice === 'field' ? winnerName : loserName}</b> will bowl first</span>
            </div>
          </div>
        )}

        <div className={s.ctaBar}>
          <button
            className={`${s.startBtn} ${!tossWinner || !choice ? s.startBtnDisabled : ''}`}
            onClick={startMatch}
            disabled={!tossWinner || !choice}>
            🏏 Start Match
          </button>
        </div>
      </main>
    </div>
  );
}
