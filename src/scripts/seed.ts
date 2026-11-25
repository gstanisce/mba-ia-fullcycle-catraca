import { pool } from '../db.js';
import { runMigrations } from '../migrate.js';
import { runSeed } from '../seed.js';

await runMigrations();
await runSeed();
console.log('seed ok');
await pool.end();
