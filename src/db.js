const mysql = require('mysql2/promise');
require('dotenv').config();

let pool = null;

const getPool = () => {
  if (process.env.DB_RUN !== 'true') return null;
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      waitForConnections: true,
      connectionLimit: 10,
    });
  }
  return pool;
};

const query = async (sql, params = []) => {
  const p = getPool();
  if (!p) throw new Error('DB_RUN is false');
  const [rows] = await p.execute(sql, params);
  return rows;
};

module.exports = { query, getPool };
