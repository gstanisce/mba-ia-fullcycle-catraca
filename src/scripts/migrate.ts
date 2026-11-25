import { pool } from '../db.js';
import { runMigrations } from '../migrate.js';

const applied = await runMigrations();
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'no pending migrations');
await pool.end();
