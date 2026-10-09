import jsQR from 'jsqr';
import { pickImage } from '../pickImage';

export type JoinLink = { code: string; server?: string; role?: 'scorer' | 'streamer' };

// QR payload: cricscore://join?code=ABC123&server=<api base>&role=streamer. A bare 6-character code also works.
export const buildJoinLink = (code: string, server: string, role?: 'scorer' | 'streamer') =>
  `cricscore://join?code=${code}&server=${encodeURIComponent(server)}${role ? `&role=${role}` : ''}`;

export const parseJoinLink = (text: string): JoinLink | null => {
  const t = text.trim();
  if (/^[A-Za-z0-9]{6}$/.test(t)) return { code: t.toUpperCase() };
  const m = t.match(/^cricscore:\/\/join\?(.*)$/i);
  if (!m) return null;
  const params: Record<string, string> = {};
  m[1].split('&').forEach(pair => {
    const [k, v = ''] = pair.split('=');
    params[k] = decodeURIComponent(v);
  });
  if (!/^[A-Za-z0-9]{6}$/.test(params.code || '')) return null;
  const role = params.role === 'streamer' || params.role === 'scorer' ? params.role : undefined;
  return { code: params.code.toUpperCase(), server: params.server || undefined, role };
};

// Decodes a QR code from a photo or screenshot in the browser (same jsQR decoder as the app).
// Resolves null if the user cancels; throws if no QR code is found.
export const scanQrFromImage = async (source: 'camera' | 'gallery'): Promise<JoinLink | null> => {
  const img = await pickImage({ camera: source === 'camera', maxSize: 900, quality: 0.92 });
  if (!img) return null;
  const pixels = await new Promise<ImageData>((resolve, reject) => {
    const el = new Image();
    el.onload = () => {
      const c = document.createElement('canvas');
      c.width = el.width; c.height = el.height;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(el, 0, 0);
      resolve(ctx.getImageData(0, 0, c.width, c.height));
    };
    el.onerror = () => reject(new Error('Could not read this image. Use a photo or a JPG/PNG screenshot of the QR code.'));
    el.src = img.uri;
  });
  const found = jsQR(pixels.data, pixels.width, pixels.height, { inversionAttempts: 'attemptBoth' });
  if (!found) throw new Error('No QR code found. Hold the camera steady, fill the frame with the QR code and try again.');
  const link = parseJoinLink(found.data);
  if (!link) throw new Error('This QR code is not a CricScore match code');
  return link;
};
