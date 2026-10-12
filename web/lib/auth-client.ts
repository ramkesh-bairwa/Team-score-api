// Browser helpers for the website login (/api/auth/*). The session lives in the HttpOnly cs_session cookie.
export type AuthUser = { id: string; name: string; mobile: string };

export const DEVICE_KEY = 'cricscore_device_id';

export class AuthRequestError extends Error {
  constructor(message: string, public status: number, public data: any) {
    super(message);
  }
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/auth/${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new AuthRequestError('Could not reach CricScore. Check your connection and try again.', 0, {});
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthRequestError(data?.error || 'Something went wrong', res.status, data);
  return data as T;
}

// hasPin: the account logs in with its PIN (no code is made); otherwise a code to verify + create a PIN
export type OtpResponse = { success: true; otp?: string; expiresIn?: number; isNewUser: boolean; hasPin?: boolean };

export const requestOtp = (mobile: string, name?: string) =>
  call<OtpResponse>('POST', 'otp', { mobile, ...(name ? { name } : {}) });

export const verifyOtp = (mobile: string, otp: string, pin: string, name?: string) =>
  call<{ success: true; user: AuthUser }>('POST', 'verify', { mobile, otp, pin, ...(name ? { name } : {}) });

export const loginWithPin = (mobile: string, pin: string) =>
  call<{ success: true; user: AuthUser }>('POST', 'pin', { mobile, pin });

/** The logged-in user, null when not logged in (401). Throws on network/server errors. */
export async function fetchMe(): Promise<AuthUser | null> {
  try {
    return (await call<{ user: AuthUser }>('GET', 'me')).user;
  } catch (e) {
    if (e instanceof AuthRequestError && e.status === 401) return null;
    throw e;
  }
}

/** Only allow same-site paths as a post-login destination. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/';
  if (next === '/login' || next.startsWith('/login?') || next.startsWith('/login/')) return '/';
  return next;
}

/** After login: the site's services read cricscore_device_id to know "my" matches/teams, so tie it to the account. */
export function completeLogin(user: AuthUser, next?: string | null) {
  try { localStorage.setItem(DEVICE_KEY, `web-${user.id}`); } catch { /* storage blocked */ }
  // Full navigation: the services cache the device id in memory
  window.location.href = safeNext(next);
}

export async function logoutAndRedirect() {
  try { localStorage.removeItem(DEVICE_KEY); } catch { /* ignore */ }
  try { await call('POST', 'logout'); } catch { /* the cookie is cleared server-side when reachable */ }
  window.location.href = '/login';
}
