import pg from 'pg';
import { config } from './config.js';

// Return BIGINT counts (e.g. COUNT(*)) as JS numbers; our values are small.
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 30 });

export type Db = pg.Pool | pg.PoolClient;

/** Runs fn inside BEGIN/COMMIT on a dedicated client; ROLLBACK on error. */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
