import { makeReq, run } from '@/lib/server/express';

export const dynamic = 'force-dynamic';

// Same answer as the old API: { status: 'ok', db: DB_RUN }
export async function GET(request: Request) {
  const url = new URL(request.url);
  return run((req, res) => res.json({ status: 'ok', db: process.env.DB_RUN === 'true' }), makeReq(request, url, '', {}, undefined));
}
export const HEAD = GET;
