import { Pool, QueryResult, QueryResultRow } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'cyphr_admin',
  password: process.env.DB_PASSWORD || 'cyphr_secret_password',
  database: process.env.DB_NAME || 'cyphrdrive_dev',
  max: 20, // Connection pool limit
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('[PostgreSQL] Unexpected error on idle client:', err);
  process.exit(-1);
});

export const query = async <T extends QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> => {
  const start = Date.now();
  const res = await pool.query<T>(text, params);
  const duration = Date.now() - start;
  if (process.env.NODE_ENV !== 'production') {
    console.log(`[SQL Query] Execution took ${duration}ms | Rows: ${res.rowCount}`);
  }
  return res;
};