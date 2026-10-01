'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Compositor } from '@/lib/compositor';
import { countCameras, describeMediaError, getCameraStream, getVideoOnly, stopStream, type Facing } from '@/lib/media';
import { withBase } from '@/lib/paths';
import { ChunkedRecorder, isRecordingSupported, type RecorderStatus } from '@/lib/recorder';
import { createSocket, type ClientSocket } from '@/lib/socket-client';
import type { LiveScore } from '@/types/score';
import type { IceCandidatePayload, RoomStatus } from '@/types/socket';
import { useIceServers } from './useIceServers';

export type BroadcastPhase = 'preview' | 'live' | 'ended';
export type SocketStatus = 'connecting' | 'connected' | 'disconnected';

interface Options {
  // Rooms linked to a CricScore match draw the live scoreboard onto the video
  scoreOverlay: boolean;
}

// Media pipeline: camera + mic → canvas compositor (adds scoreboard) → outgoing stream.
// The outgoing stream (canvas video + mic audio) feeds every peer connection and the recorder.
export function useBroadcaster(roomId: string, initialStatus: RoomStatus, { scoreOverlay }: Options) {
  const iceServers = useIceServers();
  const socketRef = useRef<ClientSocket | null>(null);
  const cameraRef = useRef<MediaStream | null>(null);
  const compositorRef = useRef<Compositor | null>(null);
  const streamRef = useRef<MediaStream | null>(null); // outgoing
  const recorderRef = useRef<ChunkedRecorder | null>(null);
  const recordEnabledRef = useRef(true);
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

  const stopRecorder = useCallback(async () => {
    const rec = recorderRef.current;
    recorderRef.current = null;
    if (rec) await rec.stop();
  }, []);

  // Start a new segment, or resume the current one after a pause
  const startRecorder = useCallback(async () => {
    if (!recordEnabledRef.current || !streamRef.current || !isRecordingSupported()) return;
    if (recorderRef.current?.active) return recorderRef.current.resume();
    const rec = new ChunkedRecorder(roomId, streamRef.current, setRecorderStatus);
    recorderRef.current = rec;
    try {
      await rec.start();
    } catch (err) {
      recorderRef.current = null;
      setRecorderStatus({ recording: false, paused: false, uploadedBytes: 0, pendingChunks: 0, error: (err as Error).message });
    }
  }, [roomId]);

  // Signaling
  useEffect(() => {
    if (initialStatus === 'ENDED') return;
    const socket = createSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketStatus('connected');
      socket.emit('join-room', { roomId, role: 'broadcaster' }, (res) => {
        if (!res.ok) {
          setError(res.error);
          if (res.code === 'ENDED') setPhase('ended');
          return;
        }
        setError(null);
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

    // Server ended the room (e.g. reconnect grace period ran out)
    socket.on('stream-ended', () => {
      liveRef.current = false;
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
  }, [roomId, initialStatus, connectToViewer, closePeer, closeAllPeers, stopRecorder]);

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
        void startRecorder();
      } else {
        liveRef.current = false;
        setError(res.error);
      }
    });
  }, [startRecorder]);

  const stopLive = useCallback(() => {
    const socket = socketRef.current;
    if (!socket) return;
    liveRef.current = false;
    closeAllPeers();
    recorderRef.current?.pause();
    setBusy(true);
    socket.emit('stream-stopped', (res) => {
      setBusy(false);
      if (!res.ok) setError(res.error);
      setPhase('preview');
    });
  }, [closeAllPeers]);

  const endStream = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket) return;
    liveRef.current = false;
    setBusy(true);
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
  }, [closeAllPeers, stopRecorder]);

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
      setFacing(next);
    } catch (err) {
      setError(describeMediaError(err));
    }
  }, [facing]);

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
  };
}
