import { execute, queryOne } from './db';
import type { MatchResult } from '../types/result';

// Results are stored once and never change: a finished match stays finished, even after the
// CricScore server forgets the live session

const known = new Set<string>();

export async function getMatchResult(externalRef: string | null): Promise<MatchResult | null> {
  if (!externalRef) return null;
  const row = await queryOne<{ result_json: string }>('SELECT result_json FROM match_results WHERE external_ref = ? LIMIT 1', [
    externalRef,
  ]);
  if (!row) return null;
  try {
    return JSON.parse(row.result_json) as MatchResult;
  } catch {
    return null;
  }
}

export async function saveMatchResult(externalRef: string, result: MatchResult): Promise<void> {
  if (known.has(externalRef)) return;
  await execute('INSERT IGNORE INTO match_results (external_ref, result_json) VALUES (?, ?)', [externalRef, JSON.stringify(result)]);
  known.add(externalRef);
}

// Live score of a linked room from the CricScore API; records the result when the match is over
export async function fetchMatchScore(externalRef: string) {
  const base = process.env.CRICSCORE_API_URL?.replace(/\/+$/, '');
  if (!externalRef.startsWith('cricscore:') || !base) return null;
  const res = await fetch(`${base}/live/${encodeURIComponent(externalRef.slice('cricscore:'.length))}/overlay`, {
    cache: 'no-store',
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) return null;
  const score = (await res.json()) as { final?: MatchResult | null };
  if (score.final) await saveMatchResult(externalRef, score.final).catch((err) => console.error('[result] save failed', err));
  return score;
}

// For server-side callers (room end) that just want the result recorded if there is one
export function captureMatchResult(externalRef: string | null) {
  if (externalRef) fetchMatchScore(externalRef).catch(() => {});
}
