import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';

// One pool per process. Next.js route handlers and the custom Socket.IO server load this
// module through different bundles, so the pool is cached on globalThis to share it.
const globalForDb = globalThis as unknown as { __mysqlPool?: Pool };

function createPool(): Pool {
  const { DATABASE_HOST, DATABASE_PORT, DATABASE_USER, DATABASE_PASSWORD, DATABASE_NAME } = process.env;
  if (!DATABASE_HOST || !DATABASE_USER || !DATABASE_NAME) {
    throw new Error('Database is not configured. Set DATABASE_HOST, DATABASE_USER and DATABASE_NAME.');
  }
  const pool = mysql.createPool({
    host: DATABASE_HOST,
    port: Number(DATABASE_PORT || 3306),
    user: DATABASE_USER,
    password: DATABASE_PASSWORD || undefined,
    database: DATABASE_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    timezone: 'Z',
    dateStrings: false,
  });
  // Store and read every DATETIME as UTC
  pool.on('connection', (conn) => {
    conn.query("SET time_zone = '+00:00'");
  });
  return pool;
}

export function getPool(): Pool {
  if (!globalForDb.__mysqlPool) globalForDb.__mysqlPool = createPool();
  return globalForDb.__mysqlPool;
}

export async function queryRows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await getPool().query<RowDataPacket[]>(sql, params);
  return rows as T[];
}

export async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await queryRows<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [result] = await getPool().execute<ResultSetHeader>(sql, params as never[]);
  return result;
}
