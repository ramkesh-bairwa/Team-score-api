import type { NextConfig } from 'next';

// Runs through server.ts (website + API + WebRTC signaling in one process).
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The old Express API answered /api/x/ like /api/x; don't redirect trailing slashes
  skipTrailingSlashRedirect: true,
  serverExternalPackages: ['mysql2'],
  poweredByHeader: false,
};

export default nextConfig;
