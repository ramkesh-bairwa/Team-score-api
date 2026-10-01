'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createSocket, type ClientSocket } from '@/lib/socket-client';
import type { IceCandidatePayload, RoomStatus } from '@/types/socket';
import { useIceServers } from './useIceServers';

export type ViewerStatus =
  | 'connecting' // joining the room over Socket.IO
  | 'waiting' // room exists, broadcaster hasn't gone live
  | 'paused' // broadcaster stopped the stream but may resume
  | 'negotiating' // live, setting up the WebRTC connection
  | 'live' // receiving media
  | 'reconnecting' // signaling or peer connection dropped
  | 'broadcaster-away' // broadcaster disconnected, room still open
  | 'ended'
  | 'error';

export function useViewer(roomId: string, initialStatus: RoomStatus) {
  const iceServers = useIceServers();
  const socketRef = useRef<ClientSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const endedRef = useRef(initialStatus === 'ENDED');

  const [status, setStatus] = useState<ViewerStatus>(initialStatus === 'ENDED' ? 'ended' : 'connecting');
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [viewerCount, setViewerCount] = useState(0);
  const [socketConnected, setSocketConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearRetry = () => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  };

  const closePeer = useCallback(() => {
    clearRetry();
    const pc = pcRef.current;
    if (pc) {
      pc.ontrack = null;
      pc.onicecandidate = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }
    pcRef.current = null;
    pendingIceRef.current = [];
    setRemoteStream(null);
  }, []);

  const joinRoom = useCallback(() => {
    const socket = socketRef.current;
    if (!socket?.connected || endedRef.current) return;
    socket.emit('join-room', { roomId, role: 'viewer' }, (res) => {
      if (!res.ok) {
        if (res.code === 'ENDED') {
          endedRef.current = true;
          setStatus('ended');
          socket.disconnect();
        } else {
          setError(res.error);
          setStatus('error');
        }
        return;
      }
      setError(null);
      setViewerCount(res.viewerCount);
      if (res.status !== 'LIVE') setStatus('waiting');
      else setStatus(res.broadcasterOnline ? 'negotiating' : 'broadcaster-away');
    });
  }, [roomId]);

  // Re-joining makes the server announce us to the broadcaster again → fresh offer
  const scheduleRetry = useCallback(
    (delayMs: number) => {
      clearRetry();
      retryTimerRef.current = setTimeout(() => {
        const pc = pcRef.current;
        if (pc && pc.connectionState === 'connected') return;
        closePeer();
        setStatus('reconnecting');
        socketRef.current?.emit('leave-room');
        joinRoom();
      }, delayMs);
    },
    [closePeer, joinRoom],
  );

  useEffect(() => {
    if (initialStatus === 'ENDED') return;
    const socket = createSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
      joinRoom();
    });
    socket.on('disconnect', () => {
      setSocketConnected(false);
      // An established peer connection keeps playing; we'll get a fresh offer after re-joining
      if (!endedRef.current && pcRef.current?.connectionState !== 'connected') setStatus('reconnecting');
    });
    socket.on('connect_error', () => {
      if (!endedRef.current) setStatus('reconnecting');
    });

    socket.on('offer', async ({ from, sdp }) => {
      closePeer();
      const pc = new RTCPeerConnection({ iceServers: iceServers.current });
      pcRef.current = pc;
      setStatus('negotiating');

      pc.ontrack = (e) => {
        if (pcRef.current !== pc) return;
        setRemoteStream(e.streams[0] ?? new MediaStream([e.track]));
      };
      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        const c = e.candidate.toJSON();
        socket.emit('ice-candidate', {
          to: from,
          candidate: { ...c, candidate: c.candidate ?? '' } as IceCandidatePayload,
        });
      };
      pc.onconnectionstatechange = () => {
        if (pcRef.current !== pc) return;
        switch (pc.connectionState) {
          case 'connected':
            clearRetry();
            setStatus('live');
            break;
          case 'disconnected':
            // Often recovers on its own; re-negotiate if it doesn't
            setStatus('reconnecting');
            scheduleRetry(5000);
            break;
          case 'failed':
            setStatus('reconnecting');
            scheduleRetry(1000);
            break;
        }
      };

      try {
        await pc.setRemoteDescription(sdp);
        for (const c of pendingIceRef.current) await pc.addIceCandidate(c).catch(() => {});
        pendingIceRef.current = [];
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('answer', { to: from, sdp: { type: 'answer', sdp: answer.sdp ?? '' } });
        // If ICE never completes, start over
        scheduleRetry(15000);
      } catch (err) {
        console.error('Failed to answer offer', err);
        scheduleRetry(2000);
      }
    });

    socket.on('ice-candidate', async ({ candidate }) => {
      const pc = pcRef.current;
      if (!pc || !pc.remoteDescription) {
        pendingIceRef.current.push(candidate);
        return;
      }
      await pc.addIceCandidate(candidate).catch(() => {});
    });

    socket.on('viewer-count-updated', ({ count }) => setViewerCount(count));
    socket.on('stream-started', () => {
      if (!pcRef.current) setStatus('negotiating');
    });
    socket.on('stream-stopped', () => {
      closePeer();
      setStatus('paused');
    });
    socket.on('broadcaster-disconnected', () => {
      closePeer();
      setStatus('broadcaster-away');
    });
    socket.on('stream-ended', () => {
      endedRef.current = true;
      closePeer();
      setStatus('ended');
      socket.disconnect();
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
      closePeer();
    };
  }, [initialStatus, iceServers, joinRoom, closePeer, scheduleRetry]);

  return { status, remoteStream, viewerCount, socketConnected, error };
}
