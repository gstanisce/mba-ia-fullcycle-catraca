import { runMigrations } from '../src/migrate.js';
import { pool } from '../src/db.js';

export async function setup() {
  await runMigrations();
  await pool.end();
}
