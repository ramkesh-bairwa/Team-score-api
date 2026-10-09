import { makeReq, run } from '@/lib/server/express';
import { overlayPage } from '@/lib/server/pages';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return run(overlayPage, makeReq(request, new URL(request.url), '', { code: decodeURIComponent(code) }, undefined));
}
