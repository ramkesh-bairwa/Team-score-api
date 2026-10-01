// The app can be mounted under a sub-path (e.g. /stream behind the CricScore server).
// Next.js prefixes <Link>, router and redirects itself; fetch URLs, sockets and cookies need it explicitly.
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/+$/, '');

export const withBase = (path: string) => `${BASE_PATH}${path}`;
