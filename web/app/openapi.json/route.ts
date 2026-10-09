import { makeReq, run } from '@/lib/server/express';
import spec from '@/lib/server/openapi';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return run((req, res) => res.json(spec), makeReq(request, new URL(request.url), '', {}, undefined));
}
