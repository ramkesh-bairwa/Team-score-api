// @ts-nocheck — copied from the Express API (src/db.js); used by the legacy routes when DB_RUN=true.
import mysql from 'mysql2/promise';
import { once } from './state';

const conn = once('legacyPool', () => ({ pool: null }));

export const getPool = () => {
  if (process.env.DB_RUN !== 'true') return null;
  if (!conn.pool) {
    conn.pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
    });
  }
  return conn.pool;
};

export const query = async (sql, params = []) => {
  const p = getPool();
  if (!p) throw new Error('DB_RUN is false');
  const [rows] = await p.execute(sql, params);
  return rows;
};
