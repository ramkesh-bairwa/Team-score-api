import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || undefined,
  // Keep native/Node-only packages out of the server bundle
  serverExternalPackages: ['mysql2', 'bcryptjs'],
  // This project lives inside another repo; pin the root so Next doesn't pick the parent lockfile
  outputFileTracingRoot: __dirname,
  turbopack: { root: __dirname },
};

export default nextConfig;
