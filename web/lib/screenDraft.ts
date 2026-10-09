// Form drafts for the match-setup flow (SetupTeam → Bet → Toss).
// On the web, pressing Back remounts the previous page, so its form state is kept in sessionStorage.
// A draft is tied to the nav entry the screen was opened with (lib/nav writes a new `key` every time
// a screen is navigated to): coming Back restores it, opening the screen fresh starts empty.
import type { Screen } from './nav';

export const SETUP_DRAFT = 'cricscore_draft_SetupTeam';
export const BET_DRAFT = 'cricscore_draft_Bet';

const navKey = (screen: Screen): number => {
  try { return JSON.parse(sessionStorage.getItem(`cricscore_nav_${screen}`) || '{}').key ?? 0; } catch { return 0; }
};

export function loadDraft<T>(storeKey: string, screen: Screen): T | null {
  try {
    const raw = sessionStorage.getItem(storeKey);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d && d.navKey === navKey(screen) ? (d.data as T) : null;
  } catch { return null; }
}

// `fallback` is tried when the full draft doesn't fit (e.g. too many photos)
export function saveDraft(storeKey: string, screen: Screen, data: unknown, fallback?: () => unknown) {
  const put = (d: unknown) => sessionStorage.setItem(storeKey, JSON.stringify({ navKey: navKey(screen), data: d }));
  try { put(data); } catch {
    try { if (fallback) put(fallback()); } catch { /* storage full or blocked */ }
  }
}

export function clearDrafts(...keys: string[]) {
  for (const k of keys) { try { sessionStorage.removeItem(k); } catch { /* ignore */ } }
}
