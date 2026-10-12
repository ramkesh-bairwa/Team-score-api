'use client';
// /challenge?c=CODE — the opponent's side of a team challenge: see who invites you, pick your own
// team and send it. The match itself is then scored on the challenger's phone.
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import TeamPicker from '@/components/TeamPicker';
import { SharedTeam, getChallenge, acceptChallenge } from '@/lib/services/teams';
import st from './challenge.module.css';

type Info = { code: string; teamName: string; by: string; status: 'waiting' | 'accepted'; acceptedBy: string | null; mine: boolean };
const CODE_RE = /^[A-Z2-9]{6}$/;

export default function ChallengePage() {
  const [code, setCode] = useState('');
  const [info, setInfo] = useState<Info | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const [team, setTeam] = useState<SharedTeam | null>(null);
  const [sent, setSent] = useState(false);

  const load = async (c: string) => {
    setBusy(true);
    setError('');
    try {
      setInfo(await getChallenge(c));
    } catch (e: any) {
      setInfo(null);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    document.title = 'Team challenge · CricScore';
    const c = (new URLSearchParams(window.location.search).get('c') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (c) { setCode(c); load(c); }
  }, []);

  const submitCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (!CODE_RE.test(code)) { setError('Enter the 6-character code'); return; }
    window.history.replaceState(null, '', `/challenge?c=${code}`);
    load(code);
  };

  const send = async () => {
    if (!info || !team) return;
    setBusy(true);
    setError('');
    try {
      await acceptChallenge(info.code, { name: team.name, captain: team.captain, players: team.players });
      setSent(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className={st.page}>
      <header className={st.hero}>
        <div className={st.heroInner}>
          <Link href="/" className={st.back} aria-label="Back to home">←</Link>
          <span className={st.kicker}>⚔️ Team challenge</span>
          <h1 className={st.title}>Play with your team</h1>
          <p className={st.sub}>Pick your team and send it. The match is scored on the challenger’s phone.</p>
        </div>
      </header>

      <section className={st.body}>
        {!info ? (
          <form className={st.card} onSubmit={submitCode}>
            <label className={st.label} htmlFor="code">Challenge code</label>
            <input
              id="code"
              className={st.codeInput}
              value={code}
              placeholder="ABC123"
              maxLength={6}
              autoCapitalize="characters"
              autoComplete="off"
              onChange={e => { setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)); setError(''); }}
            />
            {error && <p className={st.error} role="alert">{error}</p>}
            <button className={st.primary} type="submit" disabled={busy}>{busy ? 'Checking…' : 'Open challenge'}</button>
          </form>
        ) : sent ? (
          <div className={st.card}>
            <div className={st.big}>✅</div>
            <h2 className={st.h2}>{team?.name} is in!</h2>
            <p className={st.text}>{info.by} now starts the match ({info.teamName} vs {team?.name}) on their phone.</p>
            <Link href="/" className={st.secondary}>Go to Home</Link>
          </div>
        ) : (
          <div className={st.card}>
            <div className={st.vs}>
              <div className={st.side}><span className={st.sideLabel}>Challenger</span><b>{info.teamName}</b><span className={st.by}>by {info.by}</span></div>
              <span className={st.vsDisk}>VS</span>
              <div className={st.side}><span className={st.sideLabel}>Your team</span><b>{team ? team.name : '—'}</b>{team && <span className={st.by}>{team.players.length} players</span>}</div>
            </div>
            {info.mine ? (
              <p className={st.text}>This is your own challenge. Share the code or QR with the other team’s phone.</p>
            ) : info.status === 'accepted' ? (
              <p className={st.text}>{info.acceptedBy ? `${info.acceptedBy} has` : 'Someone has'} already accepted this challenge.</p>
            ) : (
              <>
                <button className={st.secondaryBtn} type="button" onClick={() => setPicker(true)}>👥 {team ? 'Pick a different team' : 'Pick my team'}</button>
                {error && <p className={st.error} role="alert">{error}</p>}
                <button className={st.primary} type="button" onClick={send} disabled={!team || busy}>{busy ? 'Sending…' : 'Send my team ✓'}</button>
                <p className={st.fine}>Your team isn’t listed? <Link href="/teams">Create it in Teams</Link>, then come back to this link.</p>
              </>
            )}
          </div>
        )}
      </section>

      <TeamPicker
        visible={picker}
        title="Pick your team"
        onPick={t => { setTeam(t); setPicker(false); setError(''); }}
        onClose={() => setPicker(false)}
      />
    </main>
  );
}
