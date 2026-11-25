import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { runSeed } from '../src/seed.js';

describe('harness', () => {
  afterAll(async () => {
    await pool.end();
  });

  it('GET /health answers 200', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('migrations and seed can run again without error', async () => {
    await runMigrations();
    await runSeed();
    await runSeed();
  });
});
