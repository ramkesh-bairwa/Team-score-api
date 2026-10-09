import type { NextConfig } from 'next';

// The website runs (systemd, port 3400) behind the same domain as the CricScore API (Nginx sends /api, /stream, /overlay…
// to the API). In development, /api and /health are proxied to API_ORIGIN instead.
const API_ORIGIN = process.env.API_ORIGIN || 'https://score.glamofashion.com';

const nextConfig: NextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  async rewrites() {
    if (process.env.NODE_ENV === 'production') return [];
    return [
      { source: '/api/:path*', destination: `${API_ORIGIN}/api/:path*` },
      { source: '/health', destination: `${API_ORIGIN}/health` },
    ];
  },
};

export default nextConfig;
