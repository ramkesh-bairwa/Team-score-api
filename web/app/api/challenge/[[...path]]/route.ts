// Team challenges: a match creator invites another user to bring their own team, by code or QR.
// New endpoints only (website); logged-in users only. Kept in memory: a challenge lives for a few hours.
//   POST /api/challenge                 { teamName }            -> { code, token }      (creator)
//   GET  /api/challenge/:code                                   -> { code, teamName, by, status }
//   POST /api/challenge/:code/accept    { team }                -> { ok }               (opponent, once)
//   GET  /api/challenge/:code/result?token=                     -> { status, team?, acceptedBy? } (creator)
import crypto from 'crypto';
import { once } from '@/lib/server/state';
import { readSessionCookie, userForToken } from '@/lib/server/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Team = { name: string; captain: string; players: { name: string; nickname?: string; mobile?: string; roles?: string[] }[] };
type Challenge = {
  code: string; tokenHash: string; teamName: string; by: string; byId: string; createdAt: number;
  status: 'waiting' | 'accepted'; team?: Team; acceptedBy?: string; acceptedById?: string;
};

const TTL_MS = 6 * 60 * 60 * 1000;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const challenges = once('teamChallenges', () => new Map<string, Challenge>());
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const fail = (status: number, error: string) => json({ error }, status);
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

const sweep = () => {
  const now = Date.now();
  for (const [code, c] of challenges) if (now - c.createdAt > TTL_MS) challenges.delete(code);
};
const newCode = () => {
  let code;
  do code = Array.from({ length: 6 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  while (challenges.has(code));
  return code;
};

// The opponent's team as sent by their phone: names only, sensible sizes
const cleanTeam = (t: any): Team | null => {
  const name = str(t?.name, 60);
  const players = (Array.isArray(t?.players) ? t.players : []).slice(0, 30).map((p: any) => ({
    name: str(p?.name, 40), nickname: str(p?.nickname, 40) || undefined, mobile: str(p?.mobile, 16) || undefined,
    roles: Array.isArray(p?.roles) ? p.roles.filter((r: unknown) => typeof r === 'string').slice(0, 6).map((r: string) => r.slice(0, 20)) : [],
  })).filter((p: { name: string }) => p.name);
  if (!name || players.length < 2) return null;
  const captain = str(t?.captain, 40) || players.find((p: any) => p.roles.includes('Captain'))?.name || players[0].name;
  return { name, captain, players };
};

async function handle(req: Request) {
  sweep();
  const user = await userForToken(readSessionCookie(req));
  if (!user) return fail(401, 'Log in first');
  const url = new URL(req.url);
  const seg = url.pathname.replace(/^\/api\/challenge\/?/i, '').split('/').filter(Boolean);

  if (!seg.length && req.method === 'POST') {
    const body = await req.json().catch(() => ({}));
    const teamName = str(body?.teamName, 60);
    if (!teamName) return fail(400, 'Enter your team name first');
    const token = crypto.randomBytes(16).toString('hex');
    const code = newCode();
    challenges.set(code, { code, tokenHash: sha(token), teamName, by: user.name, byId: user.id, createdAt: Date.now(), status: 'waiting' });
    return json({ code, token });
  }

  const c = challenges.get(String(seg[0] || '').toUpperCase());
  if (!c) return fail(404, 'Challenge code not found or expired');

  if (seg.length === 1 && req.method === 'GET') {
    return json({ code: c.code, teamName: c.teamName, by: c.by, status: c.status, acceptedBy: c.acceptedBy || null, mine: c.byId === user.id });
  }
  if (seg[1] === 'accept' && req.method === 'POST') {
    if (c.status !== 'waiting') return fail(409, c.acceptedById === user.id ? 'You already sent your team' : 'Another team already accepted this challenge');
    const team = cleanTeam((await req.json().catch(() => ({})))?.team);
    if (!team) return fail(400, 'Pick a team with at least 2 players');
    if (team.name.toLowerCase() === c.teamName.toLowerCase()) return fail(400, 'Your team needs a different name from the challenger');
    Object.assign(c, { status: 'accepted', team, acceptedBy: user.name, acceptedById: user.id });
    return json({ ok: true });
  }
  if (seg[1] === 'result' && req.method === 'GET') {
    const token = url.searchParams.get('token') || '';
    if (!token || sha(token) !== c.tokenHash) return fail(403, 'Not allowed');
    return json({ status: c.status, team: c.team || null, acceptedBy: c.acceptedBy || null });
  }
  return fail(404, 'Unknown endpoint');
}

export const GET = handle;
export const POST = handle;
