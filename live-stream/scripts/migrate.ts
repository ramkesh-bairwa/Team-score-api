import { loadEnvConfig } from '@next/env';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';

// Creates DATABASE_NAME if missing and applies database/schema.sql (idempotent)
loadEnvConfig(process.cwd());

async function main() {
  const { DATABASE_HOST, DATABASE_PORT, DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME } = process.env;
  if (!DATABASE_HOST || !DATABASE_USER || !DATABASE_NAME) throw new Error('Set DATABASE_* in .env first');
  if (!/^[A-Za-z0-9_]+$/.test(DATABASE_NAME)) throw new Error('DATABASE_NAME may only contain letters, digits and _');

  const conn = await mysql.createConnection({
    host: DATABASE_HOST,
    port: Number(DATABASE_PORT || 3306),
    user: DATABASE_USER,
    password: DATABASE_PASSWORD || undefined,
    multipleStatements: true,
  });
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${DATABASE_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    await conn.query(`USE \`${DATABASE_NAME}\``);
    await conn.query(readFileSync(path.join(process.cwd(), 'database', 'schema.sql'), 'utf8'));
    console.log(`Schema applied to "${DATABASE_NAME}"`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
