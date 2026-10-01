import { NextResponse } from 'next/server';

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

// Defence in depth on top of SameSite=Lax cookies: reject cross-site state-changing requests
export function isSameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true; // non-browser clients and same-origin navigations
  // Proxies may append values ("a, b"); the first is what the browser used
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host'))?.split(',')[0].trim();
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
