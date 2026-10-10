'use client';

import { useState } from 'react';
import type { RoomStatus } from '@/types/socket';
import BroadcasterView from './BroadcasterView';
import RemoteView from './RemoteView';

interface Props {
  roomId: string;
  title: string;
  description: string | null;
  initialStatus: RoomStatus;
  hasScoreOverlay: boolean;
  // Another device of the owner was already filming when the page loaded
  cameraOnline: boolean;
}

// The owner's studio: the first device is the camera, every other device becomes a remote
export default function StudioView({ cameraOnline, ...props }: Props) {
  const [mode, setMode] = useState<'camera' | 'remote'>(cameraOnline ? 'remote' : 'camera');
  if (mode === 'remote') {
    return (
      <RemoteView
        roomId={props.roomId}
        title={props.title}
        initialStatus={props.initialStatus}
        hasScoreOverlay={props.hasScoreOverlay}
        onBecomeCamera={() => setMode('camera')}
      />
    );
  }
  return <BroadcasterView {...props} onCameraBusy={() => setMode('remote')} />;
}
