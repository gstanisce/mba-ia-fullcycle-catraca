import { pool } from '../src/db.js';
import { runSeed } from '../src/seed.js';

/** Empties every application table (keeps schema_migrations) and re-runs the seed. */
export async function resetDb(): Promise<void> {
  const { rows } = await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migrations'",
  );
  if (rows.length) {
    await pool.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  }
  await runSeed();
}
