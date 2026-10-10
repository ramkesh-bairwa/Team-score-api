'use client';
import React, { useEffect, useState, useRef } from 'react';
import AsyncStorage from '@/lib/storage';
import {
  getInProgressMatch, clearInProgressMatch, listMatches, getMatch, clearMyMatches,
  pendingMatchCount, syncPendingMatches,
} from '@/lib/services/api';
import { C } from '@/lib/theme';
import { popup, PopupCard, PopupIcon } from '@/components/Popup';
import { requestJoin, getJoinStatus, takeOverScoring, LivePayload, LiveSession, JoinRole } from '@/lib/services/live';
import { isServerConfigured, setApiUrl } from '@/lib/services/server';
import { scanQrFromImage } from '@/lib/utils/qrScan';
import ServerSettings from '@/components/ServerSettings';
import UserMenu from '@/components/UserMenu';
import { pendingTeamCount, isServerReachable, syncPendingTeams } from '@/lib/services/teams';
import s from './HomeScreen.module.css';

const SCORER_NAME_KEY = 'cricscore_scorer_name';
const WELCOME_KEY = 'cricscore_welcome_seen';
// Wait for a closing popup card to finish animating before opening the next one
const afterClose = (fn: () => void) => setTimeout(fn, 220);

// Watch codes: 6 characters, A–Z and 2–9
const WATCH_CODE_RE = /^[A-Z2-9]{6}$/;
// Accepts a typed code or a pasted watch link (…/stream/match/CODE, /watch/CODE, /go/CODE, ?code=CODE)
const extractWatchCode = (raw: string) => {
  const t = raw.trim();
  const known = t.match(/\/(?:stream\/match|watch|go|live)\/([A-Za-z0-9]{6})(?=$|[/?#])/i)
    || t.match(/[?&](?:code|match|join)=([A-Za-z0-9]{6})(?=$|[&#])/i);
  if (known) return known[1].toUpperCase();
  if (/[/.]/.test(t)) {
    const seg = t.split(/[/?#&=]/).reverse().find(x => /^[A-Za-z0-9]{6}$/.test(x));
    if (seg) return seg.toUpperCase();
  }
  return t.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);
};

const Spinner = ({ color = C.white, large }: { color?: string; large?: boolean }) => (
  <span className={`${s.spinner} ${large ? s.spinnerLarge : ''}`} style={{ borderColor: color, borderTopColor: 'transparent' }} />
);

export default function HomeScreen({ navigation }: any) {
  const [ready, setReady] = useState(false);
  const [history, setHistory] = useState<any[]>([]);
  const [inProgress, setInProgress] = useState<any | null>(null);
  const [pwdModal, setPwdModal] = useState(false);
  const [pwdInput, setPwdInput] = useState('');
  const [joinModal, setJoinModal] = useState(false);
  const [serverModal, setServerModal] = useState(false);
  // Teams saved offline, shown with a Sync option once the server is reachable
  const [pendingTeams, setPendingTeams] = useState(0);
  const [teamsOnline, setTeamsOnline] = useState(false);
  const [syncingTeams, setSyncingTeams] = useState(false);
  const [pendingMatches, setPendingMatches] = useState(0);
  const [historyOffline, setHistoryOffline] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [joinName, setJoinName] = useState('');
  const [joinState, setJoinState] = useState<'form' | 'sending' | 'waiting'>('form');
  const [joinHost, setJoinHost] = useState('');
  const [scanning, setScanning] = useState(false);
  const [joinRole, setJoinRole] = useState<JoinRole>('streamer');
  const joinPoll = useRef<ReturnType<typeof setInterval> | null>(null);
  // Watch a live match (opens the public stream page in a new tab)
  const [watchCode, setWatchCode] = useState('');
  const [watchTried, setWatchTried] = useState(false);
  const watchInput = useRef<HTMLInputElement | null>(null);
  const watchBadChars = /[^A-Z2-9]/.test(watchCode);
  const watchError = watchBadChars
    ? 'Codes use letters A–Z and digits 2–9 only (no 0 or 1).'
    : watchTried && watchCode.length < 6
      ? `Enter all 6 characters of the match code (${watchCode.length}/6).`
      : '';

  const playWatch = () => {
    if (!WATCH_CODE_RE.test(watchCode)) {
      setWatchTried(true);
      watchInput.current?.focus();
      return;
    }
    window.open(`${window.location.origin}/stream/match/${watchCode}`, '_blank', 'noopener');
  };

  const focusWatch = () => {
    watchInput.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    watchInput.current?.focus({ preventScroll: true });
  };

  const stopJoinPoll = () => {
    if (joinPoll.current) clearInterval(joinPoll.current);
    joinPoll.current = null;
  };
  useEffect(() => stopJoinPoll, []);

  // First visit: show the welcome slides once. Then load like the app does on focus,
  // and again whenever the tab becomes visible.
  useEffect(() => {
    const joinParam = new URLSearchParams(window.location.search).get('join');
    let seen = true;
    try { seen = !!localStorage.getItem(WELCOME_KEY); } catch { /* storage blocked */ }
    if (!seen && !joinParam) {
      navigation.replace('Welcome');
      return;
    }
    setReady(true);
    loadHistory();
    loadInProgress();
    checkPendingTeams();

    // Opened from a join link (/?join=ABC123): prefill the code in the Join popup
    if (joinParam) {
      const code = joinParam.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);
      window.history.replaceState(window.history.state, '', window.location.pathname);
      if (code) openJoin(code);
    }

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      loadHistory();
      loadInProgress();
      checkPendingTeams();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Match history comes from the match API (falls back to this device's copy when offline)
  const loadHistory = async () => {
    try {
      const r = await listMatches();
      setHistory(r.matches);
      setHistoryOffline(r.offline);
    } catch (_) {}
  };

  // Teams and matches saved while offline; matches upload by themselves once the server is reachable
  const checkPendingTeams = async () => {
    const n = await pendingTeamCount();
    const m = await pendingMatchCount();
    setPendingTeams(n);
    setPendingMatches(m);
    if (n || m) {
      const online = await isServerReachable();
      setTeamsOnline(online);
      if (online && m) {
        await syncPendingMatches().catch(() => null);
        setPendingMatches(await pendingMatchCount());
        loadHistory();
      }
    }
  };

  // Re-check every 15s while something is waiting, so Sync appears as soon as the net is back
  useEffect(() => {
    if ((!pendingTeams && !pendingMatches) || teamsOnline) return;
    const t = setInterval(checkPendingTeams, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingTeams, pendingMatches, teamsOnline]);

  const syncTeams = async () => {
    setSyncingTeams(true);
    try {
      const m = await syncPendingMatches().catch(() => ({ synced: 0, offline: true }));
      const r = await syncPendingTeams();
      if (m.synced) loadHistory();
      if (r.failed.length) {
        popup.alert('Synced With Problems', `Synced ${r.synced}.\n\n${r.failed.map(f => `• ${f.name}: ${f.error}`).join('\n')}`, undefined, 'warning');
      } else if (r.offline) {
        popup.alert('Sync Paused', `Synced ${r.synced}. The connection dropped; try again later.`, undefined, 'warning');
      } else {
        popup.alert('Teams Synced', `${r.synced} team change${r.synced === 1 ? '' : 's'} uploaded for everyone.`, undefined, 'success');
      }
    } finally {
      setSyncingTeams(false);
      checkPendingTeams();
    }
  };

  const loadInProgress = async () => {
    try {
      const match = await getInProgressMatch();
      setInProgress(match);
    } catch (_) {}
  };

  const resumeMatch = () => {
    if (!inProgress) return;
    navigation.navigate('Scoring', {
      battingTeam: inProgress.battingTeam,
      fieldingTeam: inProgress.fieldingTeam,
      overs: inProgress.overs,
      matchType: inProgress.matchType,
      target: inProgress.target,
      innings1: inProgress.innings1,
      originalBattingTeam: inProgress.originalBattingTeam,
      originalFieldingTeam: inProgress.originalFieldingTeam,
      bet: inProgress.bet,
      location: inProgress.location,
      savedState: inProgress.savedState,
      tossWinner: inProgress.tossWinner,
      tossChoice: inProgress.tossChoice,
      live: inProgress.live,
      matchId: inProgress.matchId,
      matchKey: inProgress.matchKey,
    });
  };

  const openJoin = async (prefill = '') => {
    setJoinCode(prefill);
    setJoinState('form');
    setJoinName((await AsyncStorage.getItem(SCORER_NAME_KEY).catch(() => null)) || '');
    setJoinModal(true);
  };

  const closeJoin = () => {
    stopJoinPoll();
    setJoinModal(false);
  };

  const enterLiveMatch = async (code: string, token: string, name: string, payload: LivePayload | null | undefined) => {
    const live: LiveSession = { code, token, role: 'scorer' };
    if (!payload) {
      popup.alert('Match Not Started', 'The scorer has not started scoring yet. Try joining again in a moment.', undefined, 'warning');
      return;
    }
    // This device becomes the only scorer; the other phone's scoring closes
    try {
      await takeOverScoring(live, name);
    } catch (e: any) {
      popup.alert('Could Not Start Scoring', e.message, undefined, 'error');
      return;
    }
    if (payload.phase === 'innings_end') {
      navigation.navigate('Scorecard', { ...payload.scorecardParams, live, liveMirror: true });
    } else {
      navigation.navigate('Scoring', { ...payload.params, savedState: payload.savedState, live });
    }
  };

  const submitJoin = async (codeArg?: string, roleArg?: JoinRole) => {
    const code = (codeArg ?? joinCode).trim().toUpperCase();
    const role = roleArg ?? joinRole;
    const name = joinName.trim();
    if (code.length !== 6) { popup.alert('Invalid Code', 'Enter the 6-character match code shown on the scorer\'s phone.', undefined, 'warning'); return; }
    if (!name) { popup.alert('Name Required', 'Enter your name so the scorer knows who is asking.', undefined, 'warning'); return; }
    if (!(await isServerConfigured())) {
      popup.show({
        type: 'warning', icon: '🖥️', title: 'Set Server Address',
        message: 'Scan the QR code instead (it sets the server automatically), or enter the server address first.',
        buttons: [{ text: 'Cancel', style: 'cancel' }, { text: 'Set Address', onPress: () => setServerModal(true) }],
      });
      return;
    }
    setJoinState('sending');
    AsyncStorage.setItem(SCORER_NAME_KEY, name).catch(() => {});
    try {
      const { requestId, hostName } = await requestJoin(code, name, role);
      setJoinHost(hostName);
      setJoinState('waiting');
      stopJoinPoll();
      joinPoll.current = setInterval(async () => {
        try {
          const st = await getJoinStatus(code, requestId);
          if (st.status === 'pending') return;
          stopJoinPoll();
          setJoinModal(false);
          afterClose(() => {
            if (st.status === 'approved' && st.role === 'streamer') {
              popup.show({
                type: 'success', icon: '📺', title: 'Connected as Live Stream',
                message: `${hostName} approved this phone as the live-stream device. You'll see the score in real time and can go live on YouTube.`,
                buttons: [{ text: 'Open Live Stream', onPress: () => navigation.navigate('LiveStream', { code, token: st.token, name }) }],
              });
            } else if (st.status === 'approved') {
              popup.show({
                type: 'success', title: 'Access Granted',
                message: `${hostName} approved your request. When you start, scoring moves to this phone and closes on theirs.`,
                buttons: [{ text: 'Start Scoring', onPress: () => enterLiveMatch(code, st.token!, name, st.payload) }],
              });
            } else {
              popup.alert('Access Denied', `${hostName} did not allow you to score this match.`, undefined, 'error');
            }
          });
        } catch (e: any) {
          stopJoinPoll();
          setJoinModal(false);
          afterClose(() => popup.alert('Connection Lost', e.message, undefined, 'error'));
        }
      }, 2500);
    } catch (e: any) {
      setJoinState('form');
      popup.alert('Could Not Join', e.message, undefined, 'error');
    }
  };

  const scanJoin = async (source: 'camera' | 'gallery') => {
    setScanning(true);
    try {
      const link = await scanQrFromImage(source);
      if (!link) return;
      // The QR carries the server address, so the joining device needs no setup
      if (link.server) await setApiUrl(link.server);
      setJoinCode(link.code);
      if (link.role) setJoinRole(link.role);
      if (joinName.trim()) submitJoin(link.code, link.role);
      else popup.alert('Code Scanned ✅', `Match ${link.code} found. Enter your name and tap Request Access.`, undefined, 'success');
    } catch (e: any) {
      popup.alert('Scan Failed', e.message, undefined, 'error');
    } finally {
      setScanning(false);
    }
  };

  const discardInProgress = () => {
    popup.alert('Discard Match?', 'This will delete the in-progress match.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: async () => {
        await clearInProgressMatch();
        setInProgress(null);
      }},
    ]);
  };

  const clearHistory = () => {
    setPwdInput('');
    setPwdModal(true);
  };

  const confirmClearHistory = () => {
    if (pwdInput !== '061093') {
      setPwdModal(false);
      afterClose(() => popup.alert('Wrong Password', 'Incorrect password. Try again.', [{ text: 'Try Again', onPress: () => { setPwdInput(''); setPwdModal(true); } }], 'error'));
      return;
    }
    setPwdModal(false);
    afterClose(() => popup.alert('Clear History', 'Delete all match history? This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear', style: 'destructive', onPress: async () => {
          await clearMyMatches();
          setHistory([]);
        },
      },
    ]));
  };

  const openMatch = async (m: any) => {
    // Full match (innings + ball-by-ball) from this device's copy or the match API
    setOpeningId(m.id);
    try {
      const full = await getMatch(m.id);
      if (!full?.innings1) {
        popup.alert('Match In Progress', 'The scorecard is available once the first innings is complete.', undefined, 'info');
        return;
      }
      navigation.navigate('Scorecard', {
        battingTeam: full.team1,
        fieldingTeam: full.team2,
        overs: full.overs,
        matchType: full.matchType,
        location: full.location,
        tossWinner: full.tossWinner,
        tossChoice: full.tossChoice,
        innings1: full.innings1,
        innings2: full.innings2 || null,
        isFirstInnings: !full.innings2,
        liveView: false,
        fromHistory: true,
        bet: full.bet || null,
      });
    } catch (e: any) {
      popup.alert('Could Not Open Match', e.message, undefined, 'error');
    } finally {
      setOpeningId(null);
    }
  };

  if (!ready) return <div className={s.container} />;

  const completedCount = history.filter((m: any) => m.status === 'completed').length;

  return (
    <div className={s.container}>
      {/* ─── Hero header ─── */}
      <header className={s.hero}>
        <div className={s.topBar}>
          <div className={s.brand}>
            <span className={s.brandMark} aria-hidden>🏏</span>
            <span className={s.brandName}>Cric<span className={s.brandAccent}>Score</span></span>
          </div>
          <div className={s.topActions}>
            <button className={s.iconBtn} onClick={() => setServerModal(true)} aria-label="Server settings" title="Server settings">
              <span className={s.iconBtnGlyph}>⚙️</span>
            </button>
            <UserMenu dark />
          </div>
        </div>

        <div className={s.heroGrid}>
          <div className={s.heroCopy}>
            <div className={s.heroGreet}>Welcome back 👋</div>
            <h1 className={s.heroTitle}>Ready for the <span className={s.heroTitleAccent}>next match?</span></h1>
            <p className={s.heroSub}>Create teams · Pick captain · Score live</p>
            <div className={s.heroCtas}>
              <button className={s.ctaPrimary} onClick={() => navigation.navigate('SetupTeam')}>
                <span className={s.ctaPlay} aria-hidden>▶</span>
                Start a New Match
              </button>
              <button className={s.ctaGhost} onClick={() => openJoin()}>🔗 Join with Code</button>
            </div>
            {history.length > 0 && (
              <div className={s.heroStats}>
                <div className={s.heroStat}>
                  <span className={s.heroStatVal}>{history.length}</span>
                  <span className={s.heroStatLabel}>Matches</span>
                </div>
                <div className={s.heroStat}>
                  <span className={s.heroStatVal}>{completedCount}</span>
                  <span className={s.heroStatLabel}>Completed</span>
                </div>
                {inProgress && (
                  <div className={s.heroStat}>
                    <span className={`${s.heroStatVal} ${s.heroStatLive}`}>1</span>
                    <span className={s.heroStatLabel}>In progress</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Watch a live match */}
          <form
            className={s.watchCard}
            onSubmit={e => { e.preventDefault(); playWatch(); }}
            noValidate>
            <div className={s.watchHead}>
              <span className={s.watchIcon} aria-hidden>📺</span>
              <div className={s.flex1}>
                <div className={s.watchTitle}>Watch a live match</div>
                <div className={s.watchSub}>Enter the 6-character match code or paste a watch link</div>
              </div>
              <span className={s.livePill}><span className={s.livePillDot} />LIVE</span>
            </div>
            <label className="sr-only" htmlFor="watch-code">Match code</label>
            <div className={s.watchRow}>
              <input
                id="watch-code"
                ref={watchInput}
                className={`${s.watchInput} ${watchError ? s.watchInputError : ''} ${WATCH_CODE_RE.test(watchCode) ? s.watchInputOk : ''}`}
                placeholder="ABC234"
                value={watchCode}
                onChange={e => { setWatchCode(extractWatchCode(e.target.value)); setWatchTried(false); }}
                autoCapitalize="characters"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="go"
                aria-invalid={!!watchError}
                aria-describedby="watch-hint"
              />
              <button type="submit" className={s.playBtn}>▶ Play Now</button>
            </div>
            <div id="watch-hint" className={`${s.watchHint} ${watchError ? s.watchHintError : ''}`} aria-live="polite">
              {watchError || (WATCH_CODE_RE.test(watchCode) ? `✓ Match ${watchCode} · opens in a new tab` : 'The live stream opens in a new tab')}
            </div>
          </form>
        </div>
      </header>

      <main className={s.main}>
        {/* Offline team changes waiting to sync */}
        {pendingTeams + pendingMatches > 0 && (
          <div className={`${s.syncBanner} ${!teamsOnline ? s.syncBannerOff : ''}`}>
            <div className={s.syncBannerText}>
              {(() => {
                const parts = [
                  pendingTeams ? `${pendingTeams} team change${pendingTeams === 1 ? '' : 's'}` : '',
                  pendingMatches ? `${pendingMatches} match${pendingMatches === 1 ? '' : 'es'}` : '',
                ].filter(Boolean).join(' + ');
                return teamsOnline ? `☁️ ${parts} ready to sync` : `📴 ${parts} saved offline`;
              })()}
            </div>
            {teamsOnline && (
              <button className={s.syncBannerBtn} onClick={syncTeams} disabled={syncingTeams}>
                {syncingTeams ? <Spinner /> : 'Sync'}
              </button>
            )}
          </div>
        )}

        {/* In-Progress Match */}
        {inProgress && (
          <section className={s.inProgressCard} aria-label="Match in progress">
            <div className={s.inProgressInfo}>
              <div className={s.inProgressHeader}>
                <span className={s.liveDot} />
                <span className={s.inProgressLabel}>MATCH IN PROGRESS</span>
              </div>
              <div className={s.inProgressTeams}>
                {inProgress.battingTeam?.name} <span className={s.vs}>vs</span> {inProgress.fieldingTeam?.name}
              </div>
              <div className={s.inProgressScoreRow}>
                <span className={s.inProgressScore}>
                  {inProgress.savedState?.totalRuns ?? 0}/{inProgress.savedState?.wickets ?? 0}
                </span>
                <span className={s.inProgressOvers}>
                  ({inProgress.savedState?.currentOver ?? 0}.{inProgress.savedState?.currentBall ?? 0} ov)
                </span>
                {inProgress.target ? <span className={s.targetChip}>Target: {inProgress.target}</span> : null}
              </div>
            </div>
            <div className={s.inProgressBtns}>
              <button className={s.resumeBtn} onClick={resumeMatch}>▶ Resume Match</button>
              <button className={s.discardBtn} onClick={discardInProgress} aria-label="Discard match" title="Discard match">✕</button>
            </div>
          </section>
        )}

        {/* Quick actions */}
        <section className={s.section}>
          <div className={s.sectionHead}>
            <h2 className={s.sectionTitle}>Quick actions</h2>
          </div>
          <div className={s.quickGrid}>
            <button className={`${s.quickTile} ${s.qBrand}`} onClick={() => navigation.navigate('SetupTeam')}>
              <span className={s.quickIcon} aria-hidden>🏏</span>
              <span className={s.quickTitle}>Start Match</span>
              <span className={s.quickSub}>Create teams · Pick captain · Score live</span>
              <span className={s.quickArrow} aria-hidden>→</span>
            </button>
            <button className={`${s.quickTile} ${s.qPitch}`} onClick={() => navigation.navigate('Teams')}>
              <span className={s.quickIcon} aria-hidden>👥</span>
              <span className={s.quickTitle}>Teams</span>
              <span className={s.quickSub}>Create a team once, everyone can play with it</span>
              <span className={s.quickArrow} aria-hidden>→</span>
            </button>
            <button className={`${s.quickTile} ${s.qSky}`} onClick={() => openJoin()}>
              <span className={s.quickIcon} aria-hidden>🔗</span>
              <span className={s.quickTitle}>Join a Match with Code</span>
              <span className={s.quickSub}>Score together with another scorer&apos;s phone</span>
              <span className={s.quickArrow} aria-hidden>→</span>
            </button>
            <button className={`${s.quickTile} ${s.qGold}`} onClick={focusWatch}>
              <span className={s.quickIcon} aria-hidden>📺</span>
              <span className={s.quickTitle}>Watch Live</span>
              <span className={s.quickSub}>Open any match&apos;s live stream with its code</span>
              <span className={s.quickArrow} aria-hidden>→</span>
            </button>
          </div>
        </section>

        {/* Match history */}
        <section className={s.section}>
          <div className={s.sectionHead}>
            <h2 className={s.sectionTitle}>
              Match History <span className={s.countPill}>{history.length}</span>
            </h2>
            {history.length > 0 && (
              <button className={s.clearBtn} onClick={clearHistory}>Clear History</button>
            )}
          </div>
          {historyOffline && <div className={s.offlineNote}>📴 Offline · showing matches saved on this phone</div>}

          {history.length === 0 ? (
            <div className={s.emptyBox}>
              <div className={s.emptyIcon}>🏏</div>
              <div className={s.emptyText}>No matches played yet</div>
              <div className={s.emptySubText}>Start a match to see history here</div>
              <button className={s.emptyCta} onClick={() => navigation.navigate('SetupTeam')}>▶ Start a New Match</button>
            </div>
          ) : (
            <div className={s.matchGrid}>
              {history.map((m: any) => {
                const status = m.status === 'completed' ? 'COMPLETED' : m.status === 'innings_break' ? 'INNINGS BREAK' : 'LIVE';
                return (
                  <button
                    key={m.id}
                    className={`${s.matchCard} ${openingId === m.id ? s.matchCardBusy : ''}`}
                    onClick={() => openMatch(m)}>
                    <div className={s.matchCardTop}>
                      <div className={s.chipRow}>
                        <span className={`${s.statusChip} ${m.status === 'completed' ? s.completedChip : m.status === 'innings_break' ? s.breakChip : s.liveChip}`}>
                          {status === 'LIVE' && <span className={s.chipDot} />}{status}
                        </span>
                        {m.pending && <span className={s.pendingChip}>NOT UPLOADED</span>}
                      </div>
                      <span className={s.matchDate}>{m.date}</span>
                    </div>
                    <div className={s.matchTeams}>
                      {m.team1} <span className={s.vs}>vs</span> {m.team2}
                    </div>
                    {!!m.score && (
                      <div className={s.matchScoreRow}>
                        <span className={s.matchScore}>{m.score}</span>
                        <span className={s.matchOvers}>({m.oversPlayed} ov){m.score2 ? `  ·  ${m.team2} ${m.score2} (${m.oversPlayed2})` : ''}</span>
                      </div>
                    )}
                    {m.result ? <div className={s.matchResult}>🏆 {m.result}</div> : null}
                    <div className={s.matchFoot}>
                      <span className={s.matchMeta}>{m.overs} ov{m.ballType ? ` · ${m.ballType} ball` : ''}</span>
                      <span className={s.viewDetail}>
                        {openingId === m.id ? <><Spinner color={C.accent} /> Opening…</> : 'Tap to view scorecard →'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* Password Popup */}
      <PopupCard visible={pwdModal} onRequestClose={() => setPwdModal(false)}>
        <PopupIcon type="warning" icon="🔒" />
        <div className={s.modalTitle}>Enter Password</div>
        <div className={s.modalSub}>Password required to clear history</div>
        <form className={s.form} onSubmit={e => { e.preventDefault(); confirmClearHistory(); }}>
          <input
            className={s.modalInput}
            placeholder="Enter password"
            type="password"
            value={pwdInput}
            onChange={e => setPwdInput(e.target.value)}
            autoFocus
          />
          <div className={s.modalBtnRow}>
            <button type="button" className={s.modalCancelBtn} onClick={() => setPwdModal(false)}>Cancel</button>
            <button type="submit" className={s.modalConfirmBtn}>Confirm</button>
          </div>
        </form>
      </PopupCard>

      <ServerSettings visible={serverModal} onClose={() => setServerModal(false)} />

      {/* Join Match Popup */}
      <PopupCard visible={joinModal} onRequestClose={closeJoin}>
        {joinState === 'waiting' ? (
          <>
            <PopupIcon type="info" icon="⏳" />
            <div className={s.modalTitle}>Waiting for Approval</div>
            <div className={s.modalSub}>
              Asked {joinHost || 'the scorer'} for access to match {joinCode.toUpperCase()}.{'\n'}Keep this screen open.
            </div>
            <div className={s.waitSpinner}><Spinner color={C.accent} large /></div>
            <button className={`${s.modalCancelBtn} ${s.modalCancelFull}`} onClick={closeJoin}>Cancel Request</button>
          </>
        ) : (
          <>
            <PopupIcon type="info" icon="🔗" />
            <div className={s.modalTitle}>Join a Match</div>
            <div className={s.modalSub}>Scan the scorer&apos;s QR code or type their code. They will need to allow you.</div>
            <div className={s.scanRow}>
              <button className={s.scanBtn} onClick={() => scanJoin('camera')} disabled={scanning}>
                {scanning ? <Spinner /> : '📷  Scan QR'}
              </button>
              <button className={`${s.scanBtn} ${s.scanBtnGhost}`} onClick={() => scanJoin('gallery')} disabled={scanning}>
                🖼️  From Photo
              </button>
            </div>
            <div className={s.orRow}>
              <div className={s.orLine} /><span className={s.orText}>or enter code</span><div className={s.orLine} />
            </div>
            <form className={s.form} onSubmit={e => { e.preventDefault(); if (joinState !== 'sending') submitJoin(); }}>
              <input
                className={`${s.modalInput} ${s.codeInput}`}
                placeholder="ABC123"
                autoCapitalize="characters"
                autoCorrect="off"
                autoComplete="off"
                spellCheck={false}
                maxLength={6}
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase())}
              />
              <input
                className={s.modalInput}
                placeholder="Your name"
                autoComplete="name"
                value={joinName}
                onChange={e => setJoinName(e.target.value)}
              />
              <div className={s.roleLabel}>THIS PHONE WILL</div>
              <div className={s.roleRow}>
                {([
                  { key: 'streamer', title: '📺 Live Stream', sub: 'Camera + YouTube' },
                  { key: 'scorer', title: '🏏 Take Over Scoring', sub: 'Other phone stops' },
                ] as const).map(r => (
                  <button type="button" key={r.key} className={`${s.roleBtn} ${joinRole === r.key ? s.roleBtnOn : ''}`} onClick={() => setJoinRole(r.key)} aria-pressed={joinRole === r.key}>
                    <span className={`${s.roleTitle} ${joinRole === r.key ? s.roleTitleOn : ''}`}>{r.title}</span>
                    <span className={s.roleSub}>{r.sub}</span>
                  </button>
                ))}
              </div>
              <div className={s.modalBtnRow}>
                <button type="button" className={s.modalCancelBtn} onClick={closeJoin}>Cancel</button>
                <button type="submit" className={`${s.modalConfirmBtn} ${s.modalConfirmSky}`} disabled={joinState === 'sending'}>
                  {joinState === 'sending' ? <Spinner /> : 'Request Access'}
                </button>
              </div>
            </form>
          </>
        )}
      </PopupCard>
    </div>
  );
}
