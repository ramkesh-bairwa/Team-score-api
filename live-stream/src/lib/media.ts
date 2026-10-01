export function describeMediaError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera/microphone permission was denied. Allow access in your browser settings and reload.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera or microphone was found on this device.';
    case 'NotReadableError':
    case 'AbortError':
      return 'Your camera or microphone is already in use by another app.';
    case 'InsecureContext':
      return 'Camera access needs HTTPS (or localhost). Open this page over https:// to broadcast.';
    default:
      return 'Could not access your camera and microphone.';
  }
}

export type Facing = 'user' | 'environment';

const videoConstraints = (facing: Facing): MediaTrackConstraints => ({
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
  facingMode: { ideal: facing },
});

function assertMediaAvailable() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error('Insecure context'), { name: 'InsecureContext' });
  }
}

export async function getCameraStream(facing: Facing = 'user'): Promise<MediaStream> {
  assertMediaAvailable();
  return navigator.mediaDevices.getUserMedia({
    video: videoConstraints(facing),
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
}

export async function getVideoOnly(facing: Facing): Promise<MediaStreamTrack> {
  assertMediaAvailable();
  const stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints(facing) });
  return stream.getVideoTracks()[0];
}

export async function countCameras(): Promise<number> {
  try {
    return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput').length;
  } catch {
    return 1;
  }
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop());
}
