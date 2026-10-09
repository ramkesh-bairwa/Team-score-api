import { makeReq, run } from '@/lib/server/express';
import { streamPage } from '@/lib/server/pages';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return run(streamPage('watch.html'), makeReq(request, new URL(request.url), '', { code: decodeURIComponent(code) }, undefined));
}
