import { makeReq, run } from '@/lib/server/express';
import { docsPage } from '@/lib/server/pages';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return run(docsPage, makeReq(request, new URL(request.url), '', {}, undefined));
}
