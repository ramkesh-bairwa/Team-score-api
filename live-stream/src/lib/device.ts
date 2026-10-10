import type { DeviceInfo } from '@/types/socket';

// Who this device is in the camera studio: a random id and a name the owner can change. Kept in
// localStorage so a reload keeps the same number in the device list.

const ID_KEY = 'cricscore-device-id';
const NAME_KEY = 'cricscore-device-name';

function defaultName(): string {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'Computer';
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

export function getDevice(): DeviceInfo {
  let id = read(ID_KEY);
  if (!id || !/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
    write(ID_KEY, id);
  }
  const name = read(NAME_KEY)?.trim().slice(0, 40) || defaultName();
  return { id, name };
}

export function saveDeviceName(name: string) {
  write(NAME_KEY, name.trim().slice(0, 40));
}
