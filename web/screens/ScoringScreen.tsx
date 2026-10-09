'use client';
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import AsyncStorage from '@/lib/storage';
import { saveInProgressMatch, clearInProgressMatch, upsertMatch, getInProgressMatch } from '@/lib/services/api';
import {
  LiveSession, LivePayload, createLiveSession, pushLiveState, pullLiveState,
  getPendingRequests, respondToRequest,
} from '@/lib/services/live';
import { popup } from '@/components/Popup';
import Celebration, { CelebrationEvent } from '@/components/Celebration';
import OverChart, { OverStat } from '@/components/OverChart';
import YouTubeLiveSheet from '@/components/YouTubeLiveSheet';
import CommentaryList, { LogEntry } from '@/components/CommentaryList';
import { commentaryFor } from '@/lib/utils/commentary';
import ServerSettings from '@/components/ServerSettings';
import ShareMatchModal from '@/components/ShareMatchModal';
import CameraLiveSheet from '@/components/CameraLiveSheet';
import { createCameraStream, CameraStream } from '@/lib/services/stream';
import { isServerConfigured } from '@/lib/services/server';
import { useBackHandler } from '@/lib/nav';
import { C } from '@/lib/theme';
import s from './ScoringScreen.module.css';

// extra: 'wd' | 'nb' | 'lb' | 'b' | 'db' (dead ball: shown in the over, never counted)
type Ball = { runs: number; extra?: string; wicket?: boolean };
type PlayerScore = { name: string; runs: number; balls: number; fours: number; sixes: number; out: boolean; howOut?: string };
type BowlerScore = {
  name: string; overs: number; balls: number; runs: number; wickets: number;
  maidens?: number; wides?: number; noBalls?: number;
};
// outIdx: index in `batters` of the batter who is out; bowlerCredit is false for run outs
type WicketInfo = { howOut: string; bowlerCredit: boolean; outIdx: number; type: string; fielder?: string };
type FallOfWicket = { score: number; wicket: number; over: string; batter: string };
type DismissalType = 'Bowled' | 'Caught' | 'LBW' | 'Run Out' | 'Stumped' | 'Hit Wicket';
const DISMISSALS: DismissalType[] = ['Bowled', 'Caught', 'LBW', 'Run Out', 'Stumped', 'Hit Wicket'];
const NEEDS_FIELDER: DismissalType[] = ['Caught', 'Run Out', 'Stumped'];

function initBatter(name: string): PlayerScore {
  return { name, runs: 0, balls: 0, fours: 0, sixes: 0, out: false };
}
function initBowler(name: string): BowlerScore {
  return { name, overs: 0, balls: 0, runs: 0, wickets: 0, maidens: 0, wides: 0, noBalls: 0 };
}

// Scorecard-style dismissal text, e.g. "c Rahul b Bumrah"
function dismissalText(type: DismissalType, bowler: string, fielder?: string) {
  switch (type) {
    case 'Bowled': return `b ${bowler}`;
    case 'Caught': return !fielder || fielder === bowler ? `c & b ${bowler}` : `c ${fielder} b ${bowler}`;
    case 'LBW': return `lbw b ${bowler}`;
    case 'Run Out': return fielder ? `run out (${fielder})` : 'run out';
    case 'Stumped': return `st ${fielder || 'keeper'} b ${bowler}`;
    case 'Hit Wicket': return `hit wicket b ${bowler}`;
  }
}
const overStat = (o: Ball[], live?: boolean): OverStat => ({
  runs: o.reduce((sum, b) => sum + b.runs, 0),
  wickets: o.filter(b => b.wicket).length,
  live,
});
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const MAX_UNDO = 12;
const ENDED_KEY = 'cricscore_scoring_ended';

const SLICES = [
  { label: 'Straight\nDrive', angle: -90, color: '#16a34a' },
  { label: 'Long\nOff', angle: -45, color: '#65a30d' },
  { label: 'Cover\nDrive', angle: 0, color: '#ca8a04' },
  { label: 'Point', angle: 45, color: '#ea580c' },
  { label: 'Square\nLeg', angle: 90, color: '#dc2626' },
  { label: 'Fine\nLeg', angle: 135, color: '#db2777' },
  { label: 'Mid\nWicket', angle: 180, color: '#9333ea' },
  { label: 'Long\nOn', angle: -135, color: '#2563eb' },
];

// ─── Web stand-in for the app's transparent <Modal> (slide-up sheet or full-screen fade) ───
function Overlay({ visible, variant = 'slide', children }: {
  visible: boolean; variant?: 'slide' | 'fade'; children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(visible);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      let inner = 0;
      const outer = requestAnimationFrame(() => { inner = requestAnimationFrame(() => setShown(true)); });
      return () => { cancelAnimationFrame(outer); cancelAnimationFrame(inner); };
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 260);
    return () => clearTimeout(t);
  }, [visible]);
  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(
    <div className={`${variant === 'fade' ? s.dirOverlay : s.modalOverlay} ${shown ? s.overlayShown : ''}`} role="dialog" aria-modal="true">
      {children}
    </div>,
    document.body,
  );
}

// Count of deliveries in a saved scoring state (used to pick the newest copy on remount)
const deliveries = (st: any): number => {
  if (!st) return -1;
  if (Array.isArray(st.ballLog)) return st.ballLog.length;
  return (st.overHistory?.flat?.().length ?? 0) + (st.balls?.length ?? 0);
};

// On the web, opening the scorecard or refreshing the browser unmounts this page and it comes back
// with the ORIGINAL route params. The latest state is always saved as the in-progress match, so
// resume from it when it belongs to this match and innings and is at least as new as the params.
export default function ScoringScreen({ navigation, route }: any) {
  const [params, setParams] = useState<any>(null);
  useEffect(() => {
    let cancelled = false;
    const p = route.params || {};
    getInProgressMatch().catch(() => null).then((ip: any) => {
      if (cancelled) return;
      let ended: any = null;
      try { ended = JSON.parse(sessionStorage.getItem(ENDED_KEY) || 'null'); } catch { /* ignore */ }
      // Newest saved copy of THIS match and innings: in-progress match first, then a finished innings
      const pick = [ip, ended].find(c => {
        if (!c || !c.savedState || !p.battingTeam) return false;
        const sameMatch = p.matchId
          ? c.matchId === p.matchId
          : !c.matchId && c.battingTeam?.name === p.battingTeam?.name
            && c.fieldingTeam?.name === p.fieldingTeam?.name && c.overs === p.overs;
        if (!sameMatch || !!c.isSecondInnings !== !!p.target) return false;
        if (!p.savedState) return true;
        if (typeof p.savedState.savedAt === 'number') return (c.savedAt ?? 0) >= p.savedState.savedAt;
        return deliveries(c.savedState) >= deliveries(p.savedState);
      });
      setParams(pick ? { ...p, savedState: pick.savedState, live: pick.live ?? p.live } : p);
    });
    return () => { cancelled = true; };
  }, []);
  if (!params) return <div className={s.container} />;
  if (!params.battingTeam) {
    // Opened without a match (e.g. direct link): nothing to score
    return (
      <div className={s.container}>
        <div className={s.noMatch}>
          <span className={s.noMatchText}>No match in progress</span>
          <button className={s.noMatchBtn} onClick={() => navigation.navigate('Home')}>Go Home</button>
        </div>
      </div>
    );
  }
  return <Scoring navigation={navigation} route={{ ...route, params }} />;
}

function Scoring({ navigation, route }: any) {
  const { battingTeam, fieldingTeam, overs, matchType, target, innings1, originalBattingTeam, originalFieldingTeam, bet, location, tossWinner, tossChoice, matchId, matchKey } = route.params;
  const isSecondInnings = !!target;
  const isLocal = matchType === 'local';
  const inningsNum: 1 | 2 = isSecondInnings ? 2 : 1;
  const scoringParams = {
    battingTeam, fieldingTeam, overs, matchType, target, innings1,
    originalBattingTeam, originalFieldingTeam, bet, location, tossWinner, tossChoice, matchId, matchKey,
  };
  // Team that batted first, for the match API record
  const firstBatting = isSecondInnings ? originalBattingTeam : battingTeam;
  const firstFielding = isSecondInnings ? originalFieldingTeam : fieldingTeam;

  // Restore from saved state if resuming
  const saved = route.params.savedState;

  const [totalRuns, setTotalRuns] = useState(saved?.totalRuns ?? 0);
  const [wickets, setWickets] = useState(saved?.wickets ?? 0);
  const [currentOver, setCurrentOver] = useState(saved?.currentOver ?? 0);
  const [currentBall, setCurrentBall] = useState(saved?.currentBall ?? 0);
  const [balls, setBalls] = useState<Ball[]>(saved?.balls ?? []);
  const [overHistory, setOverHistory] = useState<Ball[][]>(saved?.overHistory ?? []);
  const [batters, setBatters] = useState<PlayerScore[]>(saved?.batters ?? [
    initBatter(battingTeam.players[0]),
    initBatter(battingTeam.players[1]),
  ]);
  const [strikerIdx, setStrikerIdx] = useState(saved?.strikerIdx ?? 0);
  const [nextBatterIdx, setNextBatterIdx] = useState(saved?.nextBatterIdx ?? 2);
  const [bowlers, setBowlers] = useState<BowlerScore[]>(saved?.bowlers ?? [initBowler(fieldingTeam.players[0])]);
  const [currentBowlerIdx, setCurrentBowlerIdx] = useState(saved?.currentBowlerIdx ?? 0);
  // Batters who are out and have been replaced at the crease (kept for the scorecard)
  const [dismissed, setDismissed] = useState<PlayerScore[]>(saved?.dismissed ?? []);
  const [undoStack, setUndoStack] = useState<any[]>(saved?.undoStack ?? []);
  const [fallOfWickets, setFallOfWickets] = useState<FallOfWicket[]>(saved?.fallOfWickets ?? []);
  // Ball-by-ball log with commentary (not stored in undo snapshots; undo truncates it instead)
  const [ballLog, setBallLog] = useState<LogEntry[]>(saved?.ballLog ?? []);
  const [pickerSearch, setPickerSearch] = useState('');

  const [tab, setTab] = useState<'score' | 'graph' | 'log'>('score');
  const [celebration, setCelebration] = useState<CelebrationEvent | null>(null);
  const [youtubeSheet, setYoutubeSheet] = useState(false);
  const [serverModal, setServerModal] = useState(false);
  const [shareModal, setShareModal] = useState(false);
  // Free WebRTC camera stream (QR for the camera phone + watch link)
  const [cameraSheet, setCameraSheet] = useState(false);
  const [cameraLinks, setCameraLinks] = useState<CameraStream | null>(null);
  const [shareRole, setShareRole] = useState<'streamer' | 'scorer'>('streamer');
  const [streamerName, setStreamerName] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  // Set once another phone takes over scoring; this screen stops sending updates
  const handedOff = useRef(false);

  const [selectBowlerModal, setSelectBowlerModal] = useState(false);
  const [bowlerChangeManual, setBowlerChangeManual] = useState(false);
  const [selectBatterModal, setSelectBatterModal] = useState(false);
  const [wicketModal, setWicketModal] = useState(false);
  const [wideModal, setWideModal] = useState(false);
  const [directionModal, setDirectionModal] = useState(false);
  const [pendingBall, setPendingBall] = useState<{ run: number; extra?: string } | null>(null);
  // Wicket popup selections
  const [wkType, setWkType] = useState<DismissalType>('Bowled');
  const [wkFielder, setWkFielder] = useState<string | undefined>(undefined);
  const [wkOutNonStriker, setWkOutNonStriker] = useState(false);
  const [wkRuns, setWkRuns] = useState(0);

  // Live sharing: set when this match is shared via code, or joined from another phone
  const [live, setLive] = useState<LiveSession | null>(route.params.live ?? null);
  const liveRef = useRef<LiveSession | null>(live);
  const versionRef = useRef(0);
  const pendingPushes = useRef(0);
  const localEditSeq = useRef(0);
  const seenRequests = useRef(new Set<string>());
  // Resumed/joined state is already what the server has; don't re-push it on mount
  const skipPush = useRef(!!saved);

  // Match API: record the match (or the start of the 2nd innings) when scoring begins
  useEffect(() => {
    if (saved || !matchId) return;
    upsertMatch(matchId, matchKey, {
      team1: firstBatting, team2: firstFielding, overs, matchType, location, bet,
      tossWinner, tossChoice, status: 'live',
      ...(isSecondInnings ? { innings1 } : {}),
    }).catch(() => {});
  }, []);

  // Leaving mid-match saves progress and returns Home, where it can be resumed
  const confirmLeave = () => {
    popup.show({
      type: 'warning', icon: '🏠', title: 'Leave Match?',
      message: 'Your match is saved. You can resume it from the Home screen.',
      buttons: [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', onPress: () => { persistState(); navigation.navigate('Home'); } },
      ],
    });
  };

  // Browser Back (= hardware back) asks for confirmation instead of leaving.
  // While a picker/sheet is open the app's Modal swallows the back press, so do the same here.
  const anyModalOpen = selectBatterModal || selectBowlerModal || wicketModal || wideModal || directionModal;
  useBackHandler(() => {
    if (!anyModalOpen) confirmLeave();
    return true;
  });

  // Save state to storage on every meaningful change
  const stateRef = useRef<any>({});
  useEffect(() => {
    stateRef.current = { totalRuns, wickets, currentOver, currentBall, balls, overHistory, batters, strikerIdx, nextBatterIdx, bowlers, currentBowlerIdx, dismissed, undoStack, fallOfWickets, ballLog };
  });

  const persistState = (overrides: any = {}) => {
    if (handedOff.current) return; // scoring moved to another phone: its in-progress copy was cleared
    // savedAt inside the state lets a remount tell whether the in-progress copy is newer than its params
    const state = { ...stateRef.current, ...overrides, savedAt: Date.now() };
    saveInProgressMatch({
      ...scoringParams,
      savedState: state,
      isSecondInnings,
      live: liveRef.current,
    }).catch(() => {});
  };

  const pushLive = (payload: LivePayload) => {
    const l = liveRef.current;
    if (!l || handedOff.current) return;
    pendingPushes.current++;
    pushLiveState(l, payload).then(v => {
      pendingPushes.current--;
      if (v) versionRef.current = Math.max(versionRef.current, v);
    });
  };

  // Every scoring change (balls, swaps, new batter/bowler) is saved locally and sent to co-scorers
  useEffect(() => {
    if (skipPush.current) { skipPush.current = false; return; }
    localEditSeq.current++;
    persistState();
    pushLive({ phase: 'scoring', inningsNum, params: scoringParams, savedState: stateRef.current });
  }, [totalRuns, wickets, currentOver, currentBall, balls, overHistory, batters, strikerIdx, nextBatterIdx, bowlers, currentBowlerIdx, dismissed, undoStack, fallOfWickets, ballLog]);

  const applyRemoteState = (st: any) => {
    if (!st) return;
    // Called from the polling interval, so compare against the ref rather than stale render values
    const cur = stateRef.current;
    skipPush.current = true;
    // Close pickers the other scorer has already resolved
    if (st.nextBatterIdx > cur.nextBatterIdx) setSelectBatterModal(false);
    if (st.currentBowlerIdx !== cur.currentBowlerIdx || st.bowlers.length !== cur.bowlers.length) setSelectBowlerModal(false);
    setTotalRuns(st.totalRuns);
    setWickets(st.wickets);
    setCurrentOver(st.currentOver);
    setCurrentBall(st.currentBall);
    setBalls(st.balls);
    setOverHistory(st.overHistory);
    setBatters(st.batters);
    setStrikerIdx(st.strikerIdx);
    setNextBatterIdx(st.nextBatterIdx);
    setBowlers(st.bowlers);
    setCurrentBowlerIdx(st.currentBowlerIdx);
    setDismissed(st.dismissed ?? []);
    setFallOfWickets(st.fallOfWickets ?? []);
    setBallLog(st.ballLog ?? []);
    setUndoStack(st.undoStack ?? []);
    persistState(st);
  };

  const applyRemote = (payload: LivePayload) => {
    const l = liveRef.current;
    if (payload.inningsNum < inningsNum) return; // stale update from the previous innings
    if (payload.phase === 'innings_end') {
      if (payload.inningsNum !== inningsNum) return;
      clearInProgressMatch().catch(() => {});
      navigation.navigate('Scorecard', { ...payload.scorecardParams, live: l, liveMirror: true });
    } else if (payload.inningsNum > inningsNum) {
      navigation.replace('Scoring', { ...payload.params, savedState: payload.savedState, live: l });
    } else {
      applyRemoteState(payload.savedState);
    }
  };

  const askAccess = (l: LiveSession, req: { id: string; name: string; role?: string }) => {
    const stream = req.role === 'streamer';
    popup.show({
      type: 'confirm', icon: stream ? '📺' : '🙋', dismissable: false,
      title: stream ? 'Live Stream Device' : 'Scoring Access Request',
      message: stream
        ? `${req.name} wants to connect as the live-stream phone (camera + YouTube). It will only show the score, it can't change it.`
        : `${req.name} wants to take over scoring this match. If you allow, scoring on this phone will close when they start.`,
      buttons: [
        { text: 'Deny', style: 'cancel', onPress: () => { respondToRequest(l, req.id, false).catch(() => {}); } },
        { text: 'Allow', onPress: () => {
          respondToRequest(l, req.id, true)
            .then(() => popup.alert(stream ? 'Stream Phone Connected' : 'Access Given', stream
              ? `${req.name} is now the live-stream device. No other phone can connect to this match.`
              : `${req.name} can now start scoring. This phone will stop scoring when they do.`, undefined, 'success'))
            .catch((e: any) => popup.alert('Could Not Give Access', e.message, undefined, 'error'));
        }},
      ],
    });
  };

  // Another phone started scoring: close scoring here
  const closeForHandoff = (name: string) => {
    handedOff.current = true;
    clearInProgressMatch().catch(() => {});
    setSelectBatterModal(false);
    setSelectBowlerModal(false);
    setWicketModal(false);
    setWideModal(false);
    setDirectionModal(false);
    setShareModal(false);
    popup.show({
      type: 'info', icon: '📲', dismissable: false,
      title: 'Scoring Moved',
      message: `${name} has started scoring this match on their phone, so scoring on this phone is now closed.`,
      buttons: [{ text: 'OK', onPress: () => navigation.navigate('Home') }],
    });
  };

  // Poll for updates and access requests while on screen
  useEffect(() => {
    if (!live) return;
    let stopped = false;
    const tick = async () => {
      if (handedOff.current) return;
      try {
        const seq = localEditSeq.current;
        const r = await pullLiveState(live, versionRef.current);
        if (stopped) return;
        if (r.movedTo) { closeForHandoff(r.movedTo); return; }
        setStreamerName(r.streamerName ?? null);
        // Skip if a local change happened meanwhile; our own push will win
        if (!stopped && r.changed && pendingPushes.current === 0 && seq === localEditSeq.current) {
          versionRef.current = r.version;
          if (!r.fromMe && r.payload) applyRemote(r.payload);
        }
        // The phone currently scoring approves new people (server enforces this)
        if (!stopped) {
          const reqs = await getPendingRequests(live);
          reqs.filter(q => !seenRequests.current.has(q.id)).forEach(q => {
            seenRequests.current.add(q.id);
            askAccess(live, q);
          });
        }
      } catch (e: any) {
        // Server restarted and forgot the match: re-register it with the current score
        if (e?.status === 404) {
          pushLive({ phase: 'scoring', inningsNum, params: scoringParams, savedState: stateRef.current });
        }
      }
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => { stopped = true; clearInterval(id); };
  }, [live]);

  // Creates the live session on first use (shared by co-scoring and the YouTube overlay)
  const ensureSession = async (silent = false): Promise<LiveSession | null> => {
    if (liveRef.current) return liveRef.current;
    if (!(await isServerConfigured())) {
      if (silent) return null;
      popup.show({
        type: 'warning', icon: '🖥️', title: 'Set Server Address',
        message: 'Could not reach the CricScore server from this phone. Check your internet, or enter the server address.',
        buttons: [{ text: 'Cancel', style: 'cancel' }, { text: 'Set Address', onPress: () => setServerModal(true) }],
      });
      return null;
    }
    if (!silent) setConnecting(true);
    try {
      const name = (await AsyncStorage.getItem('cricscore_scorer_name').catch(() => null)) || 'the match scorer';
      const sess = await createLiveSession(name, {
        phase: 'scoring', inningsNum, params: scoringParams, savedState: stateRef.current,
      });
      versionRef.current = 1;
      liveRef.current = sess;
      setLive(sess);
      persistState();
      if (matchId) upsertMatch(matchId, matchKey, { liveCode: sess.code }).catch(() => {});
      return sess;
    } catch (e: any) {
      if (silent) return null;
      popup.show({
        type: 'error', title: 'Could Not Connect', message: e.message,
        buttons: [{ text: 'Cancel', style: 'cancel' }, { text: 'Server Address', onPress: () => setServerModal(true) }],
      });
      return null;
    } finally {
      if (!silent) setConnecting(false);
    }
  };

  // Create the live session through the API as soon as scoring starts, so sharing,
  // the QR code and the YouTube overlay are ready instantly (silently skipped when offline)
  useEffect(() => {
    if (!liveRef.current && !handedOff.current) ensureSession(true);
  }, []);

  const openYoutube = async () => {
    if (await ensureSession()) setYoutubeSheet(true);
  };

  const openCameraLive = async () => {
    const sess = await ensureSession();
    if (!sess) return;
    setCameraSheet(true);
    if (cameraLinks) return;
    try {
      setCameraLinks(await createCameraStream(sess));
    } catch (e: any) {
      setCameraSheet(false);
      setTimeout(() => popup.alert('Live Stream Unavailable', e.message, undefined, 'error'), 350);
    }
  };

  const shareMatch = async (role: 'streamer' | 'scorer' = 'streamer') => {
    if (connecting) return;
    setShareRole(role);
    if (await ensureSession()) setShareModal(true);
  };

  const swapStrike = () => setStrikerIdx(strikerIdx === 0 ? 1 : 0);

  useEffect(() => {
    if (selectBatterModal || selectBowlerModal) setPickerSearch('');
  }, [selectBatterModal, selectBowlerModal]);

  // Snapshot taken before every delivery so it can be undone
  const pushUndo = () => {
    const core = { ...stateRef.current };
    delete core.undoStack;
    delete core.ballLog;
    core.logLen = stateRef.current.ballLog.length;
    setUndoStack(st => [...st.slice(-(MAX_UNDO - 1)), core]);
  };

  const undoLastBall = () => {
    const last = undoStack[undoStack.length - 1];
    if (!last) {
      popup.alert('Nothing to Undo', 'No deliveries left to undo in this innings.', undefined, 'info');
      return;
    }
    setTotalRuns(last.totalRuns);
    setWickets(last.wickets);
    setCurrentOver(last.currentOver);
    setCurrentBall(last.currentBall);
    setBalls(last.balls);
    setOverHistory(last.overHistory);
    setBatters(last.batters);
    setStrikerIdx(last.strikerIdx);
    setNextBatterIdx(last.nextBatterIdx);
    setBowlers(last.bowlers);
    setCurrentBowlerIdx(last.currentBowlerIdx);
    setDismissed(last.dismissed ?? []);
    setFallOfWickets(last.fallOfWickets ?? []);
    if (typeof last.logLen === 'number') setBallLog(l => l.slice(0, last.logLen));
    setUndoStack(undoStack.slice(0, -1));
    setSelectBatterModal(false);
    setSelectBowlerModal(false);
  };

  const deadBall = () => {
    pushUndo();
    setBalls([...balls, { runs: 0, extra: 'db' }]);
    setBallLog(l => [...l, {
      over: `${currentOver}.${currentBall + 1}`, bat: striker.name, bowl: currentBowler.name, runs: 0, extra: 'db',
      score: `${totalRuns}/${wickets}`, kind: 'extra',
      text: commentaryFor({ bat: striker.name, bowl: currentBowler.name, runs: 0, extra: 'db' }),
    }]);
  };

  const changeBowler = () => {
    setBowlerChangeManual(true);
    setSelectBowlerModal(true);
  };

  const nonStrikerIdx = strikerIdx === 0 ? 1 : 0;
  const striker = batters[strikerIdx];
  const nonStriker = batters[nonStrikerIdx];
  const currentBowler = bowlers[currentBowlerIdx];
  const totalBalls = currentOver * 6 + currentBall;
  const maxBalls = overs * 6;
  const oversDisplay = `${currentOver}.${currentBall}`;
  const crr = totalBalls > 0 ? ((totalRuns / totalBalls) * 6).toFixed(2) : '0.00';
  const ballsLeft = Math.max(0, maxBalls - totalBalls);
  const runsNeeded = isSecondInnings ? Math.max(0, target - totalRuns) : 0;
  const rrr = isSecondInnings && ballsLeft > 0 ? ((runsNeeded / ballsLeft) * 6).toFixed(2) : null;
  const projected = totalBalls > 0 ? Math.round((totalRuns / totalBalls) * maxBalls) : 0;
  const allBatters = [...dismissed, ...batters];
  // Current innings in scorecard shape, for the live "Card" view
  const liveInnings = {
    runs: totalRuns, wickets, overs: currentOver, balls: currentBall, batters: allBatters, bowlers,
    overHistory: balls.length ? [...overHistory, balls] : overHistory, fallOfWickets, ballLog,
  };
  const yetToBat: string[] = battingTeam.players.filter((p: string) => !allBatters.some(b => b.name === p));
  const matchSearch = (name: string) => name.toLowerCase().includes(pickerSearch.trim().toLowerCase());

  let statusText: string;
  if (isSecondInnings) {
    statusText = runsNeeded === 0
      ? `${battingTeam.name} have reached the target! 🎉`
      : `Need ${plural(runsNeeded, 'run')} in ${plural(ballsLeft, 'ball')}`;
  } else {
    statusText = totalBalls === 0
      ? `${battingTeam.name} to bat · ${overs} overs`
      : `Projected score ${projected} at ${crr} RPO`;
  }

  const allBalls = [...overHistory.flat(), ...balls];
  const thisOverRuns = balls.reduce((sum, b) => sum + b.runs, 0);
  const chartData: OverStat[] = [...overHistory.map(o => overStat(o)), ...(balls.length ? [overStat(balls, true)] : [])];
  const compareData: OverStat[] | undefined = innings1?.overHistory?.map((o: Ball[]) => overStat(o));
  const fours = allBalls.filter(b => b.runs === 4 && !b.extra).length;
  const sixes = allBalls.filter(b => b.runs === 6 && !b.extra).length;
  const dots = allBalls.filter(b => b.runs === 0 && !b.extra && !b.wicket).length;
  const extras = allBalls.filter(b => b.extra && b.extra !== 'db').reduce((sum, b) => sum + b.runs, 0);
  const bestOver = overHistory.reduce((best, o, i) => {
    const r = overStat(o).runs;
    return r > best.runs ? { runs: r, over: i + 1 } : best;
  }, { runs: -1, over: 0 });

  const handleRunPress = (run: number, extra?: string) => {
    if (run > 0) {
      setPendingBall({ run, extra });
      setDirectionModal(true);
    } else {
      addBall(run, extra);
    }
  };

  const addBall = (run: number, extra?: string, wicket?: WicketInfo) => {
    const isWicket = !!wicket;
    pushUndo();
    // For wides/no-balls `run` = 1 penalty + runs taken. Local match: no penalty run and the ball counts.
    const isWideOrNb = extra === 'wd' || extra === 'nb';
    const localExtra = isLocal && isWideOrNb;
    const actualRun = localExtra ? run - 1 : run;
    const actualExtra = extra;
    const ranRuns = isWideOrNb ? run - 1 : run; // runs the batters actually ran
    const ball: Ball = { runs: actualRun, extra: actualExtra, wicket: isWicket };
    const newBalls = [...balls, ball];
    const isLegal = !actualExtra || actualExtra === 'lb' || actualExtra === 'b' || localExtra;

    // Update bowler
    const updatedBowlers = [...bowlers];
    updatedBowlers[currentBowlerIdx] = {
      ...currentBowler,
      // Byes and leg byes are not charged to the bowler
      runs: currentBowler.runs + (actualExtra === 'lb' || actualExtra === 'b' ? 0 : actualRun),
      balls: isLegal ? currentBowler.balls + 1 : currentBowler.balls,
      wickets: wicket?.bowlerCredit ? currentBowler.wickets + 1 : currentBowler.wickets,
      wides: (currentBowler.wides ?? 0) + (actualExtra === 'wd' ? 1 : 0),
      noBalls: (currentBowler.noBalls ?? 0) + (actualExtra === 'nb' ? 1 : 0),
    };

    // Update batter
    const updatedBatters = [...batters];
    if (isLegal) {
      updatedBatters[strikerIdx] = {
        ...striker,
        runs: actualExtra ? striker.runs : striker.runs + actualRun,
        balls: striker.balls + 1,
        fours: actualRun === 4 && !actualExtra ? striker.fours + 1 : striker.fours,
        sixes: actualRun === 6 && !actualExtra ? striker.sixes + 1 : striker.sixes,
      };
    }

    // Ball-by-ball log entry with commentary
    const outName = wicket ? batters[wicket.outIdx].name : '';
    const line = commentaryFor({
      bat: striker.name, bowl: currentBowler.name, runs: actualRun, extra: actualExtra,
      wicket: wicket ? { type: wicket.type, fielder: wicket.fielder, outBatter: outName } : undefined,
    });
    const boundary = !actualExtra && !isWicket && (actualRun === 4 || actualRun === 6);
    setBallLog(l => [...l, {
      over: `${currentOver}.${currentBall + 1}`, bat: striker.name, bowl: currentBowler.name,
      runs: actualRun, extra: actualExtra, wicket: isWicket, text: line,
      score: `${totalRuns + actualRun}/${wickets + (isWicket ? 1 : 0)}`,
      kind: isWicket ? 'wicket' : actualExtra ? 'extra' : boundary ? (actualRun === 6 ? 'six' : 'four') : actualRun ? 'run' : 'dot',
    }]);

    if (boundary) {
      setCelebration({ kind: actualRun === 6 ? 'six' : 'four', batter: striker.name, line, id: Date.now() });
    }

    setTotalRuns((r: number) => r + actualRun);
    setBowlers(updatedBowlers);
    setBatters(updatedBatters);

    let newBall = currentBall;
    let newOver = currentOver;
    let newStrikerIdx = strikerIdx;

    // Odd runs taken (including off a wide/no-ball) swap the batters' ends
    if (ranRuns % 2 !== 0 && !isWicket) {
      newStrikerIdx = nonStrikerIdx;
      setStrikerIdx(nonStrikerIdx);
    }

    if (isLegal) {
      newBall = currentBall + 1;

      if (newBall === 6) {
        setOverHistory(h => [...h, newBalls]);
        setBalls([]);
        newBall = 0;
        newOver = currentOver + 1;
        newStrikerIdx = newStrikerIdx === 0 ? 1 : 0;
        setStrikerIdx(newStrikerIdx);
        // Over complete: credit the bowler a full over; maiden if nothing was conceded off the bat or as wd/nb
        const conceded = newBalls.reduce((sum, b) => sum + (b.extra === 'lb' || b.extra === 'b' ? 0 : b.runs), 0);
        const bw = updatedBowlers[currentBowlerIdx];
        updatedBowlers[currentBowlerIdx] = {
          ...bw, overs: bw.overs + 1, balls: 0, maidens: (bw.maidens ?? 0) + (conceded === 0 ? 1 : 0),
        };
        setBowlers(updatedBowlers);
        if (newOver < overs) { setBowlerChangeManual(false); setSelectBowlerModal(true); }
      } else {
        setBalls(newBalls);
      }
    } else {
      setBalls(newBalls);
    }

    setCurrentBall(newBall === 6 ? 0 : newBall);
    setCurrentOver(newOver);

    if (wicket) {
      setWickets((w: number) => w + 1);
      updatedBatters[wicket.outIdx] = { ...updatedBatters[wicket.outIdx], out: true, howOut: wicket.howOut };
      setBatters(updatedBatters);
      setFallOfWickets(f => [...f, {
        score: totalRuns + actualRun,
        wicket: wickets + 1,
        over: `${newOver}.${newBall === 6 ? 0 : newBall}`,
        batter: updatedBatters[wicket.outIdx].name,
      }]);
      // Ask for the next batter if anyone is left to bat
      const batted = new Set([...dismissed, ...updatedBatters].map(b => b.name));
      if (battingTeam.players.some((p: string) => !batted.has(p))) {
        setSelectBatterModal(true);
      }
    }

    const newTotalRuns = totalRuns + actualRun;
    const newWickets = wickets + (isWicket ? 1 : 0);
    const chaseWon = isSecondInnings && newTotalRuns >= target;
    const allOut = newWickets >= battingTeam.players.length - 1;
    const inningsEnded = chaseWon || newOver >= overs || (isWicket && allOut);

    // Persist state after every ball (the change effect then saves the complete state again)
    persistState({
      totalRuns: newTotalRuns, wickets: newWickets,
      currentOver: newOver, currentBall: newBall === 6 ? 0 : newBall,
      balls: newBall === 6 ? [] : newBalls,
      batters: updatedBatters, bowlers: updatedBowlers,
      strikerIdx: newStrikerIdx, nextBatterIdx,
    });

    if (inningsEnded) {
      setTimeout(() => endInnings(updatedBatters, updatedBowlers, newTotalRuns, newWickets, newOver, newBall === 6 ? 0 : newBall), 300);
    }
  };

  const handleWicket = () => {
    setWkType('Bowled');
    setWkFielder(undefined);
    setWkOutNonStriker(false);
    setWkRuns(0);
    setWicketModal(true);
  };

  const confirmWicket = () => {
    const isRunOut = wkType === 'Run Out';
    setWicketModal(false);
    addBall(isRunOut ? wkRuns : 0, undefined, {
      howOut: dismissalText(wkType, currentBowler.name, wkFielder),
      type: wkType,
      fielder: wkFielder,
      bowlerCredit: !isRunOut,
      outIdx: isRunOut && wkOutNonStriker ? nonStrikerIdx : strikerIdx,
    });
  };

  const endInnings = (b: PlayerScore[], bwl: BowlerScore[], runs: number, wkts: number, ov: number, bl: number) => {
    clearInProgressMatch().catch(() => {});
    // Web: remember the finished innings for this tab, so going Back from the scorecard shows it
    // again (in the app the scoring screen simply stays mounted underneath)
    try {
      sessionStorage.setItem(ENDED_KEY, JSON.stringify({
        ...scoringParams, isSecondInnings, live: liveRef.current,
        savedState: { ...stateRef.current, savedAt: Date.now() }, savedAt: Date.now(),
      }));
    } catch { /* ignore */ }
    // Called after a short delay from addBall, so read history/dismissed from the ref
    const cur = stateRef.current;
    const history: Ball[][] = cur.balls.length ? [...cur.overHistory, cur.balls] : cur.overHistory;
    const inningsData = {
      runs, wickets: wkts, overs: ov, balls: bl,
      batters: [...cur.dismissed, ...b], bowlers: bwl, overHistory: history,
      fallOfWickets: cur.fallOfWickets,
      ballLog: cur.ballLog,
    };
    const scorecardParams = isSecondInnings
      ? {
        battingTeam: originalBattingTeam,
        fieldingTeam: originalFieldingTeam,
        overs, matchType, location, bet,
        tossWinner, tossChoice,
        innings1,
        innings2: inningsData,
        isFirstInnings: false,
        liveView: false,
      }
      : {
        battingTeam, fieldingTeam, overs, matchType, location, bet,
        tossWinner, tossChoice,
        innings1: inningsData,
        isFirstInnings: true,
        liveView: false,
      };
    pushLive({ phase: 'innings_end', inningsNum, params: scoringParams, scorecardParams });
    // Match API: save the finished innings (the result is saved by the scorecard)
    if (matchId) {
      upsertMatch(matchId, matchKey, isSecondInnings
        ? { innings2: inningsData }
        : { innings1: inningsData, status: 'innings_break' }).catch(() => {});
    }
    navigation.navigate('Scorecard', { ...scorecardParams, live: liveRef.current, matchId, matchKey });
  };

  const ballColor = (ball: Ball) => {
    if (ball.wicket) return { bg: C.primary, text: C.white };
    if (ball.extra === 'db') return { bg: '#E2E8F0', text: '#64748B' };
    if (ball.extra === 'wd') return { bg: C.orangeLight, text: C.orange };
    if (ball.extra === 'nb') return { bg: C.orangeLight, text: C.orange };
    if (ball.runs === 6) return { bg: '#7C3AED', text: C.white };
    if (ball.runs === 4) return { bg: C.accentLight, text: C.accent };
    return { bg: C.divider, text: C.text };
  };

  const ballLabel = (ball: Ball) => {
    if (ball.wicket) return 'W';
    if (ball.extra === 'db') return 'DB';
    if (ball.extra === 'wd' || ball.extra === 'nb') {
      // Domestic runs include the 1-run penalty; local matches have no penalty
      const taken = isLocal ? ball.runs : ball.runs - 1;
      return `${ball.extra === 'wd' ? 'Wd' : 'Nb'}${taken > 0 ? '+' + taken : ''}`;
    }
    if (ball.extra === 'lb') return `Lb${ball.runs}`;
    if (ball.extra === 'b') return `B${ball.runs}`;
    return `${ball.runs}`;
  };

  const sr = (b: PlayerScore) => (b.balls > 0 ? ((b.runs / b.balls) * 100).toFixed(1) : '0.0');
  const bowlerBalls = currentBowler.overs * 6 + currentBowler.balls;
  const economy = bowlerBalls > 0 ? (currentBowler.runs / (bowlerBalls / 6)).toFixed(2) : '0.00';
  const progress = Math.min(1, totalBalls / maxBalls);
  const emptySlots = Math.max(0, 6 - currentBall);

  const finishDirection = () => {
    setDirectionModal(false);
    if (pendingBall) addBall(pendingBall.run, pendingBall.extra);
    setPendingBall(null);
  };

  const openFullCard = () => navigation.navigate('Scorecard', {
    battingTeam: isSecondInnings ? originalBattingTeam : battingTeam,
    fieldingTeam: isSecondInnings ? originalFieldingTeam : fieldingTeam,
    overs, matchType, location, bet,
    innings1: isSecondInnings ? innings1 : liveInnings,
    innings2: isSecondInnings ? liveInnings : undefined,
    tossWinner, tossChoice,
    isFirstInnings: !isSecondInnings, liveView: true,
  });

  const hotBanner = isSecondInnings && runsNeeded > 0 && rrr && parseFloat(rrr) > 12;

  return (
    <div className={s.container}>
      {/* ── Scoreboard header ── */}
      <div className={s.header}>
        <div className={s.headerGlow} />
        <div className={s.headerInner}>
          <div className={s.topRow}>
            <button className={s.iconBtn} onClick={confirmLeave} aria-label="Leave match">
              <span className={s.iconBtnText}>←</span>
            </button>
            <div className={s.topActions}>
              <button className={s.ytBtn} onClick={openCameraLive}>
                <span className={s.ytPlay}><span className={s.ytPlayText}>●</span></span>
                <span className={s.pillText}>Live</span>
              </button>
              <button className={`${s.pill} ${live ? s.pillLive : ''}`} onClick={() => shareMatch()}>
                {live && <span className={s.liveDot} />}
                <span className={s.pillText}>
                  {connecting ? 'Connecting…' : live ? `${streamerName ? '📺' : '🔗'} ${live.code}` : '🔗 Share'}
                </span>
              </button>
            </div>
          </div>

          <div className={s.matchLine}>
            {isSecondInnings ? '2ND INNINGS' : '1ST INNINGS'} · {battingTeam.name} v {fieldingTeam.name}
            {bet?.ballType ? ` · ${String(bet.ballType).toUpperCase()} BALL` : ''}
          </div>
          <div className={s.scoreLine}>
            <span className={s.score}>{totalRuns}<span className={s.scoreWkts}>/{wickets}</span></span>
            <div className={s.oversBox}>
              <span className={s.oversVal}>{oversDisplay}</span>
              <span className={s.oversOf}>of {overs} ov</span>
            </div>
          </div>

          <div className={s.progressTrack}>
            <div className={s.progressFill} style={{ width: `${progress * 100}%` }} />
          </div>

          <div className={s.statRow}>
            <div className={s.statChip}><span className={s.statLabel}>CRR</span><span className={s.statVal}>{crr}</span></div>
            {isSecondInnings ? (
              <>
                <div className={s.statChip}><span className={s.statLabel}>RRR</span><span className={s.statVal}>{rrr ?? '-'}</span></div>
                <div className={s.statChip}><span className={s.statLabel}>TARGET</span><span className={s.statVal}>{target}</span></div>
              </>
            ) : (
              <div className={s.statChip}><span className={s.statLabel}>PROJECTED</span><span className={s.statVal}>{projected || '-'}</span></div>
            )}
            <button className={`${s.statChip} ${s.statChipBtn}`} onClick={openFullCard}>
              <span className={s.statLabel}>FULL</span><span className={s.statVal}>Card ›</span>
            </button>
          </div>

          <div className={`${s.statusBanner} ${hotBanner ? s.statusBannerHot : ''}`}>
            <span className={s.statusIcon}>{isSecondInnings ? '🎯' : '📈'}</span>
            <span className={s.statusText}>{statusText}</span>
          </div>
        </div>
      </div>

      {/* ── This over ── */}
      <div className={s.column}>
        <div className={s.overCard}>
          <div className={s.overHead}>
            <span className={s.overTitle}>THIS OVER</span>
            <span className={s.overRuns}>{plural(thisOverRuns, 'run')}</span>
          </div>
          <div className={s.overBalls}>
            {balls.map((b, i) => {
              const col = ballColor(b);
              return (
                <div key={i} className={s.ballChip} style={{ backgroundColor: col.bg }}>
                  <span className={s.ballChipText} style={{ color: col.text }}>{ballLabel(b)}</span>
                </div>
              );
            })}
            {Array.from({ length: emptySlots }, (_, i) => <div key={`e${i}`} className={s.ballSlot} />)}
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className={s.tabs}>
          {(['score', 'log', 'graph'] as const).map(k => (
            <button key={k} className={`${s.tab} ${tab === k ? s.tabActive : ''}`} onClick={() => setTab(k)}>
              <span className={`${s.tabText} ${tab === k ? s.tabTextActive : ''}`}>
                {k === 'score' ? '🏏  Scoring' : k === 'log' ? '🎙️  Commentary' : '📊  Graph'}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className={s.scrollArea}>
        <div className={s.scroll}>
          {tab === 'score' ? (
            /* At the crease: both batters + current bowler (tap bowler to change) */
            <div className={s.card}>
              <div className={s.cardHead}>
                <span className={s.cardTitle}>AT THE CREASE</span>
                <button className={s.swapChip} onClick={swapStrike}>
                  <span className={s.swapChipText}>⇄  Swap</span>
                </button>
              </div>
              {[striker, nonStriker].map((b, i) => (
                <div key={b.name} className={`${s.batterRow} ${i === 0 ? s.batterRowOn : ''}`}>
                  <div className={`${s.strikeDot} ${i === 0 ? s.strikeDotOn : ''}`} />
                  <div className={s.batterInfo}>
                    <span className={`${s.batterName} ${i === 0 ? s.batterNameOn : ''}`}>
                      {b.name}{b.name === battingTeam.captain ? ' (c)' : ''}
                    </span>
                    <span className={s.batterMeta}>4s {b.fours} · 6s {b.sixes} · SR {sr(b)}</span>
                  </div>
                  <span className={s.batterRuns}>{b.runs}<span className={s.batterBalls}> ({b.balls})</span></span>
                </div>
              ))}
              <button className={s.bowlerLine} onClick={changeBowler}>
                <span className={s.bowlerIcon}>🎳</span>
                <span className={s.bowlerName}>{currentBowler.name}</span>
                <span className={s.bowlerFig}>
                  {currentBowler.wickets}-{currentBowler.runs}
                  <span className={s.batterBalls}>{'  '}({currentBowler.overs}.{currentBowler.balls}) · Eco {economy}</span>
                </span>
              </button>
            </div>
          ) : tab === 'log' ? (
            <div className={s.card}>
              <span className={`${s.cardTitle} ${s.cardTitleGap}`}>BALL BY BALL · {ballLog.length} DELIVERIES</span>
              <CommentaryList log={ballLog} />
            </div>
          ) : (
            <>
              <div className={s.card}>
                <span className={`${s.cardTitle} ${s.cardTitleGap}`}>RUNS PER OVER</span>
                {chartData.length === 0 && !compareData ? (
                  <span className={s.emptyChart}>The graph appears after the first ball 📊</span>
                ) : (
                  <OverChart
                    data={chartData}
                    compare={compareData}
                    totalOvers={overs}
                    teamName={battingTeam.name}
                    compareName={isSecondInnings ? fieldingTeam.name : undefined}
                  />
                )}
              </div>
              <div className={s.tiles}>
                {[
                  { label: 'Fours', val: fours, color: C.accent },
                  { label: 'Sixes', val: sixes, color: '#7C3AED' },
                  { label: 'Dot balls', val: dots, color: C.textSub },
                  { label: 'Extras', val: extras, color: C.orange },
                  { label: 'Best over', val: bestOver.runs >= 0 ? `${bestOver.runs} (#${bestOver.over})` : '-', color: C.green },
                  { label: isSecondInnings ? 'Req. rate' : 'Projected', val: isSecondInnings ? (rrr ?? '-') : (projected || '-'), color: C.primary },
                ].map(tile => (
                  <div key={tile.label} className={s.tile}>
                    <span className={s.tileVal} style={{ color: tile.color }}>{tile.val}</span>
                    <span className={s.tileLabel}>{tile.label}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Scoring pad: pinned to the bottom of the screen on the Scoring tab */}
      {tab === 'score' && (
        <div className={s.padDock}>
          <div className={s.padInner}>
            <div className={`${s.card} ${s.padCard}`}>
              <span className={s.padLabel}>RUNS</span>
              <div className={s.runRow}>
                {[0, 1, 2, 3, 4, 6].map(r => (
                  <button
                    key={r}
                    className={`${s.runCircle} ${r === 4 ? s.run4 : ''} ${r === 6 ? s.run6 : ''}`}
                    onClick={() => handleRunPress(r)}>
                    <span className={`${s.runNum} ${r === 4 || r === 6 ? s.runNumLight : ''}`}>{r === 0 ? '•' : r}</span>
                  </button>
                ))}
              </div>

              <span className={s.padLabel}>EXTRAS</span>
              <div className={s.extraRow}>
                {[
                  { label: 'WD', onPress: () => setWideModal(true) },
                  { label: 'NB', onPress: () => handleRunPress(1, 'nb') },
                  { label: 'LB', onPress: () => handleRunPress(1, 'lb') },
                  { label: 'BYE', onPress: () => handleRunPress(1, 'b') },
                  { label: 'DEAD', onPress: deadBall, dead: true },
                ].map(e => (
                  <button key={e.label} className={`${s.extraChip} ${e.dead ? s.deadChip : ''}`} onClick={e.onPress}>
                    <span className={`${s.extraChipText} ${e.dead ? s.deadChipText : ''}`}>{e.label}</span>
                  </button>
                ))}
              </div>

              <div className={s.actionRow}>
                <button
                  className={`${s.undoBtn} ${!undoStack.length ? s.btnDisabled : ''}`}
                  onClick={undoLastBall}>
                  <span className={s.undoText}>↶  Undo</span>
                </button>
                <button className={s.wicketBtn} onClick={handleWicket}>
                  <span className={s.wicketBtnText}>WICKET</span>
                </button>
              </div>
            </div>

            <button className={s.endBtn} onClick={() =>
              popup.show({
                type: 'warning', icon: '🏁', title: 'End Innings?',
                message: `${battingTeam.name} will finish on ${totalRuns}/${wickets} (${oversDisplay} ov).`,
                buttons: [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'End Innings', style: 'destructive', onPress: () => endInnings(batters, bowlers, totalRuns, wickets, currentOver, currentBall) },
                ],
              })}>
              <span className={s.endBtnText}>🏁  End Innings</span>
            </button>
          </div>
        </div>
      )}

      <Celebration event={celebration} onDone={() => setCelebration(null)} />
      <ServerSettings visible={serverModal} onClose={() => setServerModal(false)} />
      {live && (
        <CameraLiveSheet
          visible={cameraSheet}
          code={live.code}
          links={cameraLinks}
          onClose={() => setCameraSheet(false)}
          onYoutube={() => { setCameraSheet(false); setTimeout(openYoutube, 350); }}
        />
      )}
      {live && <ShareMatchModal visible={shareModal} session={live} initialRole={shareRole} onClose={() => setShareModal(false)} />}
      {live && (
        <YouTubeLiveSheet
          visible={youtubeSheet}
          session={live}
          getPayload={() => ({ phase: 'scoring', inningsNum, params: scoringParams, savedState: stateRef.current })}
          onClose={() => setYoutubeSheet(false)}
          streamerName={streamerName}
          onConnectPhone={() => { setYoutubeSheet(false); setTimeout(() => shareMatch('streamer'), 350); }}
        />
      )}

      {/* Wide Modal: runs taken off the wide */}
      <Overlay visible={wideModal}>
        <div className={s.modalBox}>
          <span className={s.modalTitle}>↔️ Wide</span>
          <span className={s.modalSub}>
            Runs taken off the wide{isLocal ? ' (local match: no extra run for the wide itself)' : ' (+1 wide run is added)'}
          </span>
          <div className={s.runsGrid}>
            {[0, 1, 2, 3, 4, 5, 6].map(r => (
              <button
                key={r}
                className={`${s.wideBtn} ${r === 4 ? s.wideBtn4 : ''} ${r === 6 ? s.wideBtn6 : ''}`}
                onClick={() => { setWideModal(false); addBall(1 + r, 'wd'); }}>
                <span className={`${s.wideBtnText} ${r >= 4 && r !== 5 ? s.wideBtnText4 : ''}`}>{r === 0 ? 'Wd' : `Wd+${r}`}</span>
                <span className={`${s.wideBtnSub} ${r >= 4 && r !== 5 ? s.wideBtnText4 : ''}`}>
                  {plural((isLocal ? 0 : 1) + r, 'run')}
                </span>
              </button>
            ))}
          </div>
          <button className={s.modalCancel} onClick={() => setWideModal(false)}>
            <span className={s.modalCancelText}>Cancel</span>
          </button>
        </div>
      </Overlay>

      {/* Wicket Modal: dismissal type, fielder, and (run outs) who is out + runs completed */}
      <Overlay visible={wicketModal}>
        <div className={s.wkSheet}>
          <span className={s.modalTitle}>🔴 Wicket</span>
          <span className={s.modalSub}>{wkType === 'Run Out' ? 'Run out' : `${striker.name} out`} · bowler {currentBowler.name}</span>

          <span className={s.wkLabel}>HOW OUT</span>
          <div className={s.wkChips}>
            {DISMISSALS.map(d => (
              <button
                key={d}
                className={`${s.wkChip} ${wkType === d ? s.wkChipOn : ''}`}
                onClick={() => { setWkType(d); setWkFielder(undefined); }}>
                <span className={`${s.wkChipText} ${wkType === d ? s.wkChipTextOn : ''}`}>{d}</span>
              </button>
            ))}
          </div>

          {NEEDS_FIELDER.includes(wkType) && (
            <>
              <span className={s.wkLabel}>{wkType === 'Stumped' ? 'KEEPER' : 'FIELDER'}</span>
              <div className={s.wkChips}>
                {fieldingTeam.players.map((p: string) => (
                  <button key={p} className={`${s.wkChip} ${wkFielder === p ? s.wkChipOn : ''}`} onClick={() => setWkFielder(p)}>
                    <span className={`${s.wkChipText} ${wkFielder === p ? s.wkChipTextOn : ''}`}>{p}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {wkType === 'Run Out' && (
            <>
              <span className={s.wkLabel}>WHO IS OUT</span>
              <div className={s.wkChips}>
                {[false, true].map(ns => (
                  <button key={String(ns)} className={`${s.wkChip} ${wkOutNonStriker === ns ? s.wkChipOn : ''}`} onClick={() => setWkOutNonStriker(ns)}>
                    <span className={`${s.wkChipText} ${wkOutNonStriker === ns ? s.wkChipTextOn : ''}`}>
                      {ns ? `${nonStriker.name} (non-striker)` : `${striker.name} (striker)`}
                    </span>
                  </button>
                ))}
              </div>
              <span className={s.wkLabel}>RUNS COMPLETED</span>
              <div className={s.wkChips}>
                {[0, 1, 2, 3].map(r => (
                  <button key={r} className={`${s.wkRun} ${wkRuns === r ? s.wkChipOn : ''}`} onClick={() => setWkRuns(r)}>
                    <span className={`${s.wkChipText} ${wkRuns === r ? s.wkChipTextOn : ''}`}>{r}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className={s.wkPreview}>
            <span className={s.wkPreviewText}>
              {(wkType === 'Run Out' && wkOutNonStriker ? nonStriker.name : striker.name)}{'  '}
              <span className={s.wkPreviewHow}>{dismissalText(wkType, currentBowler.name, wkFielder)}</span>
            </span>
          </div>
          <button className={s.wkConfirm} onClick={confirmWicket}>
            <span className={s.wkConfirmText}>Confirm Wicket</span>
          </button>
          <button className={s.modalCancel} onClick={() => setWicketModal(false)}>
            <span className={s.modalCancelText}>Cancel</span>
          </button>
        </div>
      </Overlay>

      {/* Select New Batter Modal */}
      <Overlay visible={selectBatterModal}>
        <div className={s.modalBox}>
          <span className={s.modalTitle}>🏏 Next Batter</span>
          <span className={s.modalSub}>Select incoming batter · {yetToBat.length} yet to bat</span>
          <input
            className={s.pickerSearch}
            placeholder="🔍  Search player"
            value={pickerSearch}
            onChange={e => setPickerSearch(e.target.value)}
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
          />
          <div className={s.pickerList}>
            {yetToBat.filter(matchSearch).length === 0 && <span className={s.pickerEmpty}>No player matches “{pickerSearch}”</span>}
            {yetToBat.filter(matchSearch).map((p: string) => (
              <button key={p} className={s.modalPlayerRow} onClick={() => {
                const outIdx = batters.findIndex(b => b.out);
                const slot = outIdx >= 0 ? outIdx : strikerIdx;
                const updated = [...batters];
                if (outIdx >= 0) setDismissed([...dismissed, batters[outIdx]]);
                updated[slot] = initBatter(p);
                setBatters(updated);
                setNextBatterIdx((i: number) => i + 1);
                setSelectBatterModal(false);
              }}>
                <span className={s.modalPlayerText}>{p}</span>
              </button>
            ))}
          </div>
        </div>
      </Overlay>

      {/* Direction Modal - Full Screen */}
      <Overlay visible={directionModal} variant="fade">
        {/* Header */}
        <div className={s.dirHeader}>
          <span className={s.dirTitle}>📍 Shot Direction</span>
          <span className={s.dirSub}>Tap where the ball went</span>
        </div>

        {/* Field */}
        <div className={s.fieldOuter}>
          <div className={s.fieldWrap}>
            {/* Slice segments */}
            {SLICES.map(({ label, angle, color }, idx) => {
              const midRad = (angle * Math.PI) / 180;
              const R = 128;
              const lx = R * Math.cos(midRad);
              const ly = R * Math.sin(midRad);
              return (
                <React.Fragment key={idx}>
                  <div
                    className={s.slice}
                    style={{ backgroundColor: color + '50', transform: `rotate(${angle - 22.5}deg)` }}
                  />
                  <button
                    className={s.sliceLabel}
                    style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
                    onClick={finishDirection}>
                    <span className={s.sliceBadge} style={{ backgroundColor: color + 'ee' }}>
                      <span className={s.sliceBadgeText}>{label}</span>
                    </span>
                  </button>
                </React.Fragment>
              );
            })}

            {/* Divider lines */}
            {[0, 45, 90, 135].map(deg => (
              <div key={deg} className={s.sliceLine} style={{ transform: `translate(-50%, -50%) rotate(${deg}deg)` }} />
            ))}

            {/* 30-yard circle */}
            <div className={s.infieldRing} />

            {/* ── PITCH ── */}
            <div className={s.pitch}>
              {/* Bowler end — top: ball icon above top stumps */}
              <div className={s.bowlerEndWrap}>
                <span className={s.ballIcon}>🏀</span>
                <span className={s.endLabel}>{currentBowler.name.split(' ')[0]}</span>
              </div>

              {/* Top stumps (bowler end) */}
              <div className={s.wicketTop}>
                <div className={s.stump} /><div className={s.stump} /><div className={s.stump} />
              </div>
              {/* Top crease */}
              <div className={s.creaseTop} />

              {/* Pitch surface */}
              <div className={s.pitchSurface} />

              {/* Bottom crease */}
              <div className={s.creaseBottom} />
              {/* Bottom stumps (striker end) */}
              <div className={s.wicketBottom}>
                <div className={s.stump} /><div className={s.stump} /><div className={s.stump} />
              </div>

              {/* Non-striker — just above bottom stumps */}
              <div className={s.nonStrikerWrap}>
                <span className={s.nonStrikerName}>{nonStriker.name.split(' ')[0]}</span>
              </div>

              {/* Striker — bat icon + name below bottom stumps */}
              <div className={s.strikerWrap}>
                <span className={s.batIcon}>🏏</span>
                <span className={s.strikerName}>{striker.name.split(' ')[0]} ✦</span>
              </div>
            </div>

            {/* Boundary ring */}
            <div className={s.boundaryRing} />
          </div>
        </div>

        {/* Skip */}
        <button className={s.skipDirBtn} onClick={finishDirection}>
          <span className={s.skipDirText}>Skip Direction</span>
        </button>
      </Overlay>

      {/* Select New Bowler Modal */}
      <Overlay visible={selectBowlerModal}>
        <div className={s.modalBox}>
          <span className={s.modalTitle}>🎳 {bowlerChangeManual ? 'Change Bowler' : 'New Bowler'}</span>
          <span className={s.modalSub}>{bowlerChangeManual ? 'Select who is bowling now' : 'Select bowler for next over'}</span>
          <input
            className={s.pickerSearch}
            placeholder="🔍  Search player"
            value={pickerSearch}
            onChange={e => setPickerSearch(e.target.value)}
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
          />
          <div className={s.pickerList}>
            {fieldingTeam.players.filter(matchSearch).length === 0 && <span className={s.pickerEmpty}>No player matches “{pickerSearch}”</span>}
            {fieldingTeam.players.filter(matchSearch).map((p: string) => {
              const bw = bowlers.find(b => b.name === p);
              return (
                <button key={p} className={s.modalPlayerRow} onClick={() => {
                  const existing = bowlers.findIndex(b => b.name === p);
                  if (existing >= 0) {
                    setCurrentBowlerIdx(existing);
                  } else {
                    setBowlers(bwl => [...bwl, initBowler(p)]);
                    setCurrentBowlerIdx(bowlers.length);
                  }
                  setSelectBowlerModal(false);
                }}>
                  <span className={s.modalPlayerText}>{p}</span>
                  {bw && (
                    <span className={s.modalPlayerSub}>
                      {bw.overs}.{bw.balls} ov · {bw.wickets}W
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {bowlerChangeManual && (
            <button className={s.modalCancel} onClick={() => setSelectBowlerModal(false)}>
              <span className={s.modalCancelText}>Cancel</span>
            </button>
          )}
        </div>
      </Overlay>
    </div>
  );
}
