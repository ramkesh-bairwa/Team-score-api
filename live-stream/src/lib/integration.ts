import { randomBytes, timingSafeEqual } from 'node:crypto';
import { hashPassword } from './auth';
import { createUser, findUserByEmail } from './users';

// Rooms created by CricScore are owned by one system account; camera phones get scoped sessions for it
const INTEGRATION_EMAIL = 'cricscore@integration.local';

export async function getIntegrationUser(): Promise<{ id: number; name: string }> {
  const existing = await findUserByEmail(INTEGRATION_EMAIL);
  if (existing) return { id: existing.id, name: existing.name };
  // Random password nobody knows: this account can't be logged into, only reached through host links
  try {
    const id = await createUser('CricScore', INTEGRATION_EMAIL, await hashPassword(randomBytes(32).toString('hex')));
    return { id, name: 'CricScore' };
  } catch (err) {
    if ((err as { code?: string }).code !== 'ER_DUP_ENTRY') throw err;
    const user = await findUserByEmail(INTEGRATION_EMAIL);
    return { id: user!.id, name: user!.name };
  }
}

export function isIntegrationRequest(req: Request): boolean {
  const secret = process.env.INTEGRATION_SECRET;
  if (!secret || secret.length < 32) return false;
  const given = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
