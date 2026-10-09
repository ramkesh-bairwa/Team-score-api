// Every /api/* request. Same routers, in the same order, as the old Express API (index.js):
//   /api/live, /api/shared-teams, /api/v2/matches, /api/stream*, then the legacy MySQL routes when
//   DB_RUN=true (else a JSON 404 "Unknown API endpoint").
import { BodyError, Router, errorPage, makeReq, readJsonBody, run } from '@/lib/server/express';
import live from '@/lib/server/routes/live';
import teams from '@/lib/server/routes/teams';
import matches from '@/lib/server/routes/matches';
import stream from '@/lib/server/routes/stream';
import legacy from '@/lib/server/routes/legacy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MOUNTS: [string, Router][] = [
  ['/api/live', live],
  ['/api/shared-teams', teams],
  ['/api/v2/matches', matches],
  ['/api', stream],
];

// Express mount matching: case-insensitive prefix on a path-segment boundary
const under = (path: string, mount: string) => {
  const p = path.toLowerCase();
  return p === mount || p.startsWith(`${mount}/`);
};

async function handle(request: Request) {
  const url = new URL(request.url);
  let body: any;
  try {
    body = await readJsonBody(request);
  } catch (e) {
    if (e instanceof BodyError) return errorPage(e.status, e.message);
    throw e;
  }

  for (const [mount, router] of MOUNTS) {
    if (!under(url.pathname, mount)) continue;
    const hit = router.match(request.method, url.pathname.slice(mount.length) || '/');
    if (hit) return run(hit.handler, makeReq(request, url, mount, hit.params, body));
  }

  if (process.env.DB_RUN === 'true') {
    const hit = legacy.match(request.method, url.pathname.slice('/api'.length) || '/');
    if (hit) return run(hit.handler, makeReq(request, url, '/api', hit.params, body));
    return errorPage(404, `Cannot ${request.method} ${url.pathname}`);
  }
  // The old MySQL routes are off; every other /api route above works without them
  return run(
    (req, res) => res.status(404).json({ error: `Unknown API endpoint: ${req.method} ${req.originalUrl}` }),
    makeReq(request, url, '/api', {}, body),
  );
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
