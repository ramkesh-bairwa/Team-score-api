'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getDevice, saveDeviceName } from '@/lib/device';
import { createSocket, type ClientSocket } from '@/lib/socket-client';
import type { ReplayCommand, StudioState } from '@/types/socket';

// A second (or third…) device of the room owner: it doesn't film, it sees the studio and sends
// replay commands to the camera device.
export function useRemote(roomId: string) {
  const socketRef = useRef<ClientSocket | null>(null);
  const [deviceId] = useState(() => (typeof window === 'undefined' ? '' : getDevice().id));
  const [connected, setConnected] = useState(false);
  const [studio, setStudio] = useState<StudioState | null>(null);
  const [ended, setEnded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;
    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join-room', { roomId, role: 'remote', device: getDevice() }, (res) => {
        if (res.ok) return setError(null);
        if (res.code === 'ENDED') setEnded(true);
        else setError(res.error);
      });
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('studio-update', setStudio);
    socket.on('stream-ended', () => setEnded(true));
    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomId]);

  const send = useCallback((cmd: ReplayCommand) => {
    const socket = socketRef.current;
    if (!socket?.connected) return setError('No connection to the server. Retrying…');
    socket.emit('remote-command', cmd, (res) => setError(res.ok ? null : res.error));
  }, []);

  const rename = useCallback((name: string) => {
    saveDeviceName(name);
    socketRef.current?.emit('set-device-name', { name });
  }, []);

  return { deviceId, connected, studio, ended, error, send, rename };
}
