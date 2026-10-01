import { loadEnvConfig } from '@next/env';

// Imported first by server.ts so every module below sees .env values at load time
loadEnvConfig(process.cwd());
