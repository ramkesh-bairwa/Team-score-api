'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Compositor } from '@/lib/compositor';
import { getDevice, saveDeviceName } from '@/lib/device';
import { countCameras, describeMediaError, getCameraStream, getVideoOnly, stopStream, type Facing } from '@/lib/media';
import { withBase } from '@/lib/paths';
import { ChunkedRecorder, isRecordingSupported, type RecorderStatus } from '@/lib/recorder';
import { ReplayBuffer, ReplayPlayer, isReplaySupported, planReplay, type ReplayItem } from '@/lib/replay';
import { createSocket, type ClientSocket } from '@/lib/socket-client';
import type { LiveScore, ScoreBall } from '@/types/score';
import type { CameraState, IceCandidatePayload, RoomStatus, StudioState } from '@/types/socket';
import { useIceServers } from './useIceServers';

export type BroadcastPhase = 'preview' | 'live' | 'ended';
export type SocketStatus = 'connecting' | 'connected' | 'disconnected';

// After the final result comes in, the result card stays on air this long, then the stream closes for good
const AUTO_END_MS = 15_000;
// Each ball's replay clip: the last BALL_CLIP_S seconds of camera video, taken a moment after the
// scorer records the ball (the scorer taps a few seconds after the ball is played)
const BALL_CLIP_S = 20;
const BALL_DELAY_MS = 2_500;

const describeBall = (b: ScoreBall): { kind: string; label: string } => {
  if (b.wicket) return { kind: 'W', label: 'WICKET' };
  const extra: Record<string, string> = { wd: 'Wide', nb: 'No ball', lb: 'Leg bye', b: 'Bye', db: 'Dead ball' };
  if (b.extra) return { kind: 'X', label: `${extra[b.extra] ?? 'Extra'}${b.runs > 1 ? ` +${b.runs}` : ''}` };
  if (b.runs === 6) return { kind: '6', label: 'SIX' };
  if (b.runs === 4) return { kind: '4', label: 'FOUR' };
  return { kind: String(b.runs), label: b.runs ? `${b.runs} run${b.runs === 1 ? '' : 's'}` : 'Dot ball' };
};

// "16.4" for the ball just bowled; the 6th ball shows as x.6 rather than the next over's .0
const ballOverLabel = (s: LiveScore) =>
  (s.ball ?? 0) === 0 && (s.over ?? 0) > 0 ? `${(s.over ?? 0) - 1}.6` : `${s.over ?? 0}.${s.ball ?? 0}`;

interface Options {
  // Rooms linked to a CricScore match draw the live scoreboard onto the video
  scoreOverlay: boolean;
  // Names the recording kept on the device if it can't be uploaded during the match
  title: string;
  // Another device of the owner is already the camera: this one should become a remote
  onCameraBusy?: () => void;
}

// Media pipeline: camera + mic → canvas compositor (adds scoreboard) → outgoing stream.
// The outgoing stream (canvas video + mic audio) feeds every peer connection and the recorder.
export function useBroadcaster(roomId: string, initialStatus: RoomStatus, { scoreOverlay, title, onCameraBusy }: Options) {
  const iceServers = useIceServers();
  const socketRef = useRef<ClientSocket | null>(null);
  const cameraRef = useRef<MediaStream | null>(null);
  const compositorRef = useRef<Compositor | null>(null);
  const streamRef = useRef<MediaStream | null>(null); // outgoing
  const recorderRef = useRef<ChunkedRecorder | null>(null);
  const recordEnabledRef = useRef(true);
  const replayBufRef = useRef<ReplayBuffer | null>(null);
  const replayPlayerRef = useRef<ReplayPlayer | null>(null);
  const peersRef = useRef(new Map<string, RTCPeerConnection>());
  const pendingIceRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  // Read inside socket handlers, so kept in a ref rather than state
  const liveRef = useRef(false);

  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [phase, setPhase] = useState<BroadcastPhase>(initialStatus === 'ENDED' ? 'ended' : 'preview');
  const [busy, setBusy] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [facing, setFacing] = useState<Facing>(scoreOverlay ? 'environment' : 'user');
  const [canFlip, setCanFlip] = useState(false);
  const [score, setScore] = useState<LiveScore | null>(null);
  const [recordEnabled, setRecordEnabledState] = useState(true);
  // MediaRecorder only exists in the browser; checked after mount so server and client HTML match
  const [recordSupported, setRecordSupported] = useState(false);
  useEffect(() => setRecordSupported(isRecordingSupported()), []);
  const [recorder, setRecorderStatus] = useState<RecorderStatus | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [connectedPeers, setConnectedPeers] = useState(0);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [replaySupported, setReplaySupported] = useState(false);
  useEffect(() => setReplaySupported(isReplaySupported()), []);
  const [replayAvailable, setReplayAvailable] = useState(0);
  const [replaying, setReplaying] = useState<{ rate: number } | null>(null);
  const [matchOver, setMatchOver] = useState(false);
  // Width / height of the outgoing video (16:9, or 9:16 when the phone is held upright)
  const [aspect, setAspect] = useState(16 / 9);
  const [autoEndAt, setAutoEndAt] = useState<number | null>(null);
  // Every device of the studio (this camera and the remotes), with numbers and names
  const [studio, setStudio] = useState<StudioState | null>(null);
  // "Replay by 2 · Laptop", shown for a few seconds after a remote fires one
  const [lastCommand, setLastCommand] = useState<{ text: string; at: number } | null>(null);
  // Bumped on every (re)join, so the camera state is sent again to the server
  const [joins, setJoins] = useState(0);
  const onCameraBusyRef = useRef(onCameraBusy);
  onCameraBusyRef.current = onCameraBusy;
  // Set below; called when the phone turns between portrait and landscape
  const onLayoutRef = useRef<() => void>(() => {});
  const lastBallRef = useRef<{ innings: number; deliveries: number } | null>(null);
  const inningsPostedRef = useRef(new Set<number>());

  const refreshPeerCount = useCallback(() => {
    let n = 0;
    peersRef.current.forEach((pc) => {
      if (pc.connectionState === 'connected') n++;
    });
    setConnectedPeers(n);
  }, []);

  const closePeer = useCallback(
    (viewerId: string) => {
      const pc = peersRef.current.get(viewerId);
      if (pc) {
        pc.onicecandidate = null;
        pc.onconnectionstatechange = null;
        pc.close();
        peersRef.current.delete(viewerId);
      }
      pendingIceRef.current.delete(viewerId);
      refreshPeerCount();
    },
    [refreshPeerCount],
  );

  const closeAllPeers = useCallback(() => {
    [...peersRef.current.keys()].forEach(closePeer);
  }, [closePeer]);

  const connectToViewer = useCallback(
    async (viewerId: string) => {
      const stream = streamRef.current;
      const socket = socketRef.current;
      if (!stream || !socket || !liveRef.current) return;

      closePeer(viewerId);
      const pc = new RTCPeerConnection({ iceServers: iceServers.current });
      peersRef.current.set(viewerId, pc);
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        const c = e.candidate.toJSON();
        socket.emit('ice-candidate', {
          to: viewerId,
          candidate: { ...c, candidate: c.candidate ?? '' } as IceCandidatePayload,
        });
      };
      pc.onconnectionstatechange = () => {
        refreshPeerCount();
        // The viewer re-joins on failure, which triggers a fresh offer
        if (pc.connectionState === 'failed') closePeer(viewerId);
      };

      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('offer', { to: viewerId, sdp: { type: 'offer', sdp: offer.sdp ?? '' } });
      } catch (err) {
        console.error('Failed to create offer', err);
        closePeer(viewerId);
      }
    },
    [closePeer, iceServers, refreshPeerCount],
  );

  // Camera + mic → compositor → outgoing stream (also the preview, so you see exactly what viewers see)
  useEffect(() => {
    if (initialStatus === 'ENDED') return;
    let cancelled = false;
    getCameraStream(scoreOverlay ? 'environment' : 'user')
      .then(async (camera) => {
        if (cancelled) return stopStream(camera);
        const compositor = new Compositor();
        compositor.setSource(camera);
        compositor.onLayoutChange((w, h) => {
          setAspect(w / h);
          onLayoutRef.current();
        });
        const out = new MediaStream([...compositor.stream.getVideoTracks(), ...camera.getAudioTracks()]);
        cameraRef.current = camera;
        compositorRef.current = compositor;
        streamRef.current = out;
        setLocalStream(out);
        setCanFlip((await countCameras()) > 1);
      })
      .catch((err) => setMediaError(describeMediaError(err)));
    return () => {
      cancelled = true;
      replayPlayerRef.current?.stop();
      replayBufRef.current?.stop();
      replayBufRef.current = null;
      stopStream(cameraRef.current);
      compositorRef.current?.destroy();
      cameraRef.current = null;
      compositorRef.current = null;
      streamRef.current = null;
    };
  }, [initialStatus, scoreOverlay]);

  // Live score for the overlay
  useEffect(() => {
    if (!scoreOverlay || initialStatus === 'ENDED') return;
    let alive = true;
    const tick = async () => {
      try {
        const res = await fetch(withBase(`/api/rooms/${roomId}/score`), { cache: 'no-store' });
        const data = res.ok ? ((await res.json()) as { score: LiveScore | null }) : null;
        if (!alive || !data) return;
        compositorRef.current?.setScore(data.score);
        setScore(data.score);
        setMatchOver(data.score?.phase === 'innings_end' && data.score.inningsNum === 2);
        onScoreRef.current(data.score);
      } catch {
        // keep the last score on screen
      }
    };
    tick();
    const t = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [roomId, scoreOverlay, initialStatus]);

  // Latest score handler, kept in a ref so the polling effect doesn't restart when it changes
  const onScoreRef = useRef<(s: LiveScore | null) => void>(() => {});

  const stopRecorder = useCallback(async () => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec) await rec.stop();
  }, []);

  // Start a new segment, or resume the current one after a pause
  const startRecorder = useCallback(async () => {
    if (!recordEnabledRef.current || !streamRef.current || !isRecordingSupported()) return;
    if (recorderRef.current?.active) return recorderRef.current.resume();
    // A recorder replaced by a newer one (phone turned) finishes quietly in the background
    const rec: ChunkedRecorder = new ChunkedRecorder(roomId, title, streamRef.current, (st) => {
      if (recorderRef.current === rec || recorderRef.current === null) setRecorderStatus(st);
    });
    recorderRef.current = rec;
    try {
      await rec.start();
    } catch (err) {
      recorderRef.current = null;
      setRecorderStatus({
        recording: false,
        paused: false,
        online: navigator.onLine,
        savedBytes: 0,
        uploadedBytes: 0,
        pendingChunks: 0,
        error: (err as Error).message,
      });
    }
  }, [roomId, title]);

  // The phone turned while live: the picture changes size, so the recording starts a new part
  // (one resolution per part; the server scales them all to one size for the full match video)
  onLayoutRef.current = () => {
    const old = recorderRef.current;
    if (!liveRef.current || !old?.active || old.paused) return;
    recorderRef.current = null;
    void startRecorder().finally(() => void old.stop());
  };

  // The replay buffer runs only while live: a second encoder costs battery on a phone
  const startReplayBuffer = useCallback(() => {
    const camera = cameraRef.current;
    if (!camera || !isReplaySupported() || replayBufRef.current) return;
    const buf = new ReplayBuffer(roomId);
    void buf.start(new MediaStream(camera.getVideoTracks()));
    replayBufRef.current = buf;
  }, [roomId]);

  const stopReplayBuffer = useCallback(() => {
    replayPlayerRef.current?.stop();
    replayBufRef.current?.stop();
    replayBufRef.current = null;
    setReplayAvailable(0);
  }, []);

  useEffect(() => {
    if (phase !== 'live') return;
    const t = setInterval(() => setReplayAvailable(replayBufRef.current?.available ?? 0), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Replay progress (0..1) for the studio controls
  const [replayProgress, setReplayProgress] = useState(0);
  useEffect(() => {
    if (!replaying) return setReplayProgress(0);
    const t = setInterval(() => setReplayProgress(replayPlayerRef.current?.progress() ?? 0), 250);
    return () => clearInterval(t);
  }, [replaying]);

  // Puts a replay on air: the player gets its first frame decoded before the compositor switches
  // to it (so there's no black flash), and only one replay runs at a time.
  const replayBusyRef = useRef(false);
  const putOnAir = useCallback(async (items: ReplayItem[], rate: number, onDone?: () => void) => {
    const compositor = compositorRef.current;
    if (!compositor || !items.length) {
      onDone?.();
      return false;
    }
    const player: ReplayPlayer = new ReplayPlayer(items, rate, () => {
      if (replayPlayerRef.current === player) {
        compositor.setReplay(null);
        replayPlayerRef.current = null;
        setReplaying(null);
      }
      onDone?.();
    });
    replayPlayerRef.current = player;
    const ok = await Promise.race([player.ready, new Promise<boolean>((r) => setTimeout(() => r(false), 8000))]);
    if (!ok || replayPlayerRef.current !== player) {
      if (replayPlayerRef.current === player) player.stop();
      return false;
    }
    compositor.setReplay(player);
    setReplaying({ rate });
    return true;
  }, []);

  // The last `seconds` of camera video at `rate` (scoreboard stays live on top), then back to live.
  // A new replay request while one is on air replaces it.
  const startReplay = useCallback(
    async (seconds: number, rate = 1) => {
      const buf = replayBufRef.current;
      if (!buf || !compositorRef.current || replayBusyRef.current) return;
      replayBusyRef.current = true;
      try {
        replayPlayerRef.current?.stop();
        const { clips, from } = await buf.take(seconds);
        if (!clips.length) return setError('Nothing to replay yet. Give it a few seconds.');
        const ok = await putOnAir(planReplay(clips, from), rate, () => buf.release(clips));
        if (!ok) setError('The replay could not be played. Try again.');
        else setError(null);
      } finally {
        replayBusyRef.current = false;
      }
    },
    [putOnAir],
  );

  const stopReplay = useCallback(() => replayPlayerRef.current?.stop(), []);

  // A ball replay from the server (any ball of the match, also after a page refresh)
  const playClip = useCallback(
    async (url: string) => {
      if (!compositorRef.current || replayBusyRef.current) return;
      replayBusyRef.current = true;
      try {
        replayPlayerRef.current?.stop();
        if (!(await putOnAir([{ url, ms: BALL_CLIP_S * 1000 }], 1))) setError('That ball clip could not be played.');
      } finally {
        replayBusyRef.current = false;
      }
    },
    [putOnAir],
  );

  // Uploads the replay clip of the ball that was just scored
  const captureBall = useCallback(
    async (s: LiveScore) => {
      const buf = replayBufRef.current;
      if (!buf || !s.lastBall || !s.deliveries) return;
      const { clips } = await buf.take(BALL_CLIP_S + 2);
      try {
        if (!clips.length) return;
        const totalS = (clips[clips.length - 1].end - clips[0].start) / 1000;
        const form = new FormData();
        form.append(
          'meta',
          JSON.stringify({
            innings: s.inningsNum ?? 1,
            delivery: s.deliveries,
            over: ballOverLabel(s),
            ...describeBall(s.lastBall),
            caption: (s.lastCommentary ?? '').slice(0, 300),
            trimStart: Math.max(0, totalS - BALL_CLIP_S),
          }),
        );
        clips.forEach((c, i) => form.append('clip', c.blob, `piece-${i}.${c.blob.type.includes('mp4') ? 'mp4' : 'webm'}`));
        for (let attempt = 0; attempt < 3; attempt++) {
          const res = await fetch(withBase(`/api/rooms/${roomId}/balls`), { method: 'POST', body: form }).catch(() => null);
          if (res && (res.ok || (res.status >= 400 && res.status < 500))) break;
          await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
        }
      } finally {
        buf.release(clips);
      }
    },
    [roomId],
  );

  onScoreRef.current = (s) => {
    if (!s || !scoreOverlay) return;
    const innings = s.inningsNum ?? 1;
    if (s.phase === 'innings_end') {
      if (!inningsPostedRef.current.has(innings)) {
        inningsPostedRef.current.add(innings);
        const title = `${s.battingTeam ?? 'Innings'} innings · ${s.runs ?? 0}/${s.wickets ?? 0} (${s.over ?? 0}.${s.ball ?? 0} ov)`;
        void fetch(withBase(`/api/rooms/${roomId}/innings`), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ innings, title }),
        }).catch(() => inningsPostedRef.current.delete(innings));
      }
      return;
    }
    if (s.phase !== 'scoring' || s.deliveries == null) return;
    const prev = lastBallRef.current;
    lastBallRef.current = { innings, deliveries: s.deliveries };
    // Only balls scored while this page is open (not the state found on load, not undos)
    if (prev && prev.innings === innings && s.deliveries > prev.deliveries && liveRef.current) {
      setTimeout(() => void captureBall(s), BALL_DELAY_MS);
    }
  };

  // Signaling
  useEffect(() => {
    if (initialStatus === 'ENDED') return;
    const socket = createSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketStatus('connected');
      socket.emit('join-room', { roomId, role: 'broadcaster', device: getDevice() }, (res) => {
        if (!res.ok) {
          if (res.code === 'BROADCASTER_EXISTS' && onCameraBusyRef.current) return onCameraBusyRef.current();
          setError(res.error);
          if (res.code === 'ENDED') setPhase('ended');
          return;
        }
        setError(null);
        setJoins((n) => n + 1);
        setViewerCount(res.viewerCount);
        // Reconnected while live: resume, which re-offers to every viewer
        if (liveRef.current) {
          socket.emit('stream-started', (r) => {
            if (!r.ok) setError(r.error);
          });
        }
      });
    });
    socket.on('disconnect', () => {
      setSocketStatus('disconnected');
      closeAllPeers();
    });
    socket.on('connect_error', () => setSocketStatus('disconnected'));

    socket.on('viewer-joined', ({ viewerId }) => void connectToViewer(viewerId));
    socket.on('viewer-left', ({ viewerId }) => closePeer(viewerId));
    socket.on('viewer-count-updated', ({ count }) => setViewerCount(count));

    socket.on('answer', async ({ from, sdp }) => {
      const pc = peersRef.current.get(from);
      if (!pc || pc.signalingState !== 'have-local-offer') return;
      try {
        await pc.setRemoteDescription(sdp);
        for (const c of pendingIceRef.current.get(from) ?? []) await pc.addIceCandidate(c);
        pendingIceRef.current.delete(from);
      } catch (err) {
        console.error('Failed to apply answer', err);
        closePeer(from);
      }
    });

    socket.on('ice-candidate', async ({ from, candidate }) => {
      const pc = peersRef.current.get(from);
      if (!pc) return;
      if (!pc.remoteDescription) {
        const queue = pendingIceRef.current.get(from) ?? [];
        queue.push(candidate);
        pendingIceRef.current.set(from, queue);
        return;
      }
      await pc.addIceCandidate(candidate).catch(() => {});
    });

    socket.on('studio-update', setStudio);

    // Replay asked for from another device of the studio, or the scorer's phone in the CricScore app
    socket.on('replay-command', (cmd) => {
      if (!liveRef.current) return;
      if (cmd.action === 'stop') stopReplay();
      else if (cmd.action === 'clip') void playClip(cmd.url);
      else void startReplay(cmd.seconds, cmd.rate);
      if (cmd.by) setLastCommand({ text: `${cmd.action === 'stop' ? 'Back to live' : 'Replay'} from ${cmd.by}`, at: Date.now() });
    });

    // Server ended the room (e.g. reconnect grace period ran out)
    socket.on('stream-ended', () => {
      liveRef.current = false;
      compositorRef.current?.setLive(false);
      stopReplayBuffer();
      closeAllPeers();
      void stopRecorder().finally(() => {
        stopStream(cameraRef.current);
        setPhase('ended');
      });
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      closeAllPeers();
      void stopRecorder();
    };
  }, [roomId, initialStatus, connectToViewer, closePeer, closeAllPeers, stopRecorder, stopReplayBuffer, startReplay, stopReplay, playClip]);

  // Tell the remotes what the camera is doing (they show the same replay controls and status)
  const progressStep = replaying ? Math.round(replayProgress * 20) / 20 : 0;
  useEffect(() => {
    const socket = socketRef.current;
    if (!socket?.connected || !joins || phase === 'ended') return;
    const state: CameraState = {
      phase: phase === 'live' ? 'live' : 'preview',
      replaySupported,
      replayAvailable,
      replaying: replaying ? { rate: replaying.rate, progress: progressStep } : null,
      aspect,
    };
    socket.emit('camera-state', state);
  }, [joins, socketStatus, phase, replaySupported, replayAvailable, replaying, progressStep, aspect]);

  useEffect(() => {
    if (!lastCommand) return;
    const t = setTimeout(() => setLastCommand(null), 4000);
    return () => clearTimeout(t);
  }, [lastCommand]);

  const startLive = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected || !streamRef.current) return;
    liveRef.current = true;
    setBusy(true);
    socket.emit('stream-started', (res) => {
      setBusy(false);
      if (res.ok) {
        setError(null);
        setPhase('live');
        compositorRef.current?.setLive(true);
        void startRecorder();
        startReplayBuffer();
      } else {
        liveRef.current = false;
        setError(res.error);
      }
    });
  }, [startRecorder, startReplayBuffer]);

  const stopLive = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    liveRef.current = false;
    compositorRef.current?.setLive(false);
    stopReplayBuffer();
    closeAllPeers();
    recorderRef.current?.pause();
    setBusy(true);
    socket.emit('stream-stopped', (res) => {
      setBusy(false);
      if (!res.ok) setError(res.error);
      setPhase('preview');
    });
  }, [closeAllPeers, stopReplayBuffer]);

  const endStream = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket) return;
    liveRef.current = false;
    setBusy(true);
    setAutoEndAt(null);
    stopReplayBuffer();
    // Finish uploading the recording before the room closes
    await stopRecorder();
    socket.emit('stream-ended', (res) => {
      setBusy(false);
      if (!res.ok) return setError(res.error);
      closeAllPeers();
      stopStream(cameraRef.current);
      setLocalStream(null);
      setPhase('ended');
    });
  }, [closeAllPeers, stopRecorder, stopReplayBuffer]);

  // Match over: count down, then end the stream (which finishes the recording and builds the
  // full-match video on the server). A finished match can't be reopened.
  useEffect(() => {
    setAutoEndAt(matchOver && phase === 'live' ? Date.now() + AUTO_END_MS : null);
  }, [matchOver, phase]);

  useEffect(() => {
    if (!autoEndAt) return;
    const t = setTimeout(() => void endStream(), Math.max(0, autoEndAt - Date.now()));
    return () => clearTimeout(t);
  }, [autoEndAt, endStream]);


  // Disabling a track sends silence/black frames without renegotiating
  const toggleMic = useCallback(() => {
    const track = cameraRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  }, []);

  const toggleCam = useCallback(() => {
    const track = cameraRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    compositorRef.current?.setCameraOn(track.enabled);
    setCamOn(track.enabled);
  }, []);

  // Front ↔ back camera. Only the compositor's source changes, so peers and the recording carry on.
  const flipCamera = useCallback(async () => {
    const camera = cameraRef.current;
    if (!camera) return;
    const next: Facing = facing === 'user' ? 'environment' : 'user';
    try {
      const track = await getVideoOnly(next);
      const old = camera.getVideoTracks()[0];
      track.enabled = old?.enabled ?? true;
      if (old) {
        camera.removeTrack(old);
        old.stop();
      }
      camera.addTrack(track);
      compositorRef.current?.setSource(new MediaStream([track]));
      replayBufRef.current?.setStream(new MediaStream([track]));
      setFacing(next);
    } catch (err) {
      setError(describeMediaError(err));
    }
  }, [facing]);

  const renameDevice = useCallback((name: string) => {
    saveDeviceName(name);
    socketRef.current?.emit('set-device-name', { name });
  }, []);

  const setRecordEnabled = useCallback((on: boolean) => {
    recordEnabledRef.current = on;
    setRecordEnabledState(on);
  }, []);

  return {
    localStream,
    mediaError,
    phase,
    busy,
    micOn,
    camOn,
    viewerCount,
    connectedPeers,
    socketStatus,
    error,
    startLive,
    stopLive,
    endStream,
    toggleMic,
    toggleCam,
    flipCamera,
    canFlip,
    facing,
    score,
    recordEnabled,
    recordSupported,
    setRecordEnabled,
    recorder,
    replaySupported,
    replayAvailable,
    replaying,
    replayProgress,
    startReplay,
    stopReplay,
    playClip,
    matchOver,
    autoEndAt,
    aspect,
    studio,
    lastCommand,
    renameDevice,
  };
}
