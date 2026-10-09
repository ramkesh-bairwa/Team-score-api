// One copy of the in-memory state per server process. Next.js bundles route handlers separately from
// server.ts, so module-level Maps would be duplicated; keeping them on globalThis shares them.
const g = globalThis as any;
g.__cricscore ??= {};
export const shared: Record<string, any> = g.__cricscore;

export function once<T>(key: string, make: () => T): T {
  if (!(key in shared)) shared[key] = make();
  return shared[key];
}
