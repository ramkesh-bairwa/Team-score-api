import { getApiUrl, fetchWithTimeout } from './server';
import { LiveSession } from './live';

// Free WebRTC live streaming served by the CricScore API:
//   broadcastUrl -> opened on the camera phone (from the QR) to go live in the browser
//   watchUrl     -> shared with viewers; shows the video with the live scoreboard
export type CameraStream = { broadcastUrl: string; watchUrl: string; maxViewers: number };

const call = async (method: string, path: string, body?: any) => {
  const base = await getApiUrl();
  let res: Response;
  try {
    res = await fetchWithTimeout(`${base}/stream${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }, 15000);
  } catch {
    throw new Error('Could not reach the CricScore server. Check your internet connection.');
  }
  const data = await res.json().catch(() => ({}));
  // An older server without the streaming API answers 404 / "DB_RUN is false"
  if (res.status === 404 || res.status === 503 || /DB_RUN/.test(String(data.error))) {
    throw new Error('Live streaming is not on the server yet. Deploy the latest server code (deploy/deploy.sh), then try again.');
  }
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
};

export const createCameraStream = (s: LiveSession): Promise<CameraStream> =>
  call('POST', `/${s.code}`, { token: s.token });

export const getStreamStatus = (code: string): Promise<{ live: boolean; viewers: number; maxViewers: number }> =>
  call('GET', `/${code}/status`);
