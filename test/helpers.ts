import type { FastifyInstance } from 'fastify';
import { pool } from '../src/db.js';
import { runSeed, SEED_ACCOUNTS } from '../src/seed.js';

/** Seed accounts (name, email, password, role), e.g. `SEED.organizerA.email`. */
export const SEED = SEED_ACCOUNTS;

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

/** Encodes a form body (application/x-www-form-urlencoded). */
export function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString();
}

export const FORM_HEADERS = { 'content-type': 'application/x-www-form-urlencoded' } as const;

/** Logs in through POST /login and returns the `cookie` header value (`sid=...`). Throws if login fails. */
export async function loginAs(app: FastifyInstance, email: string, password: string): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/login',
    headers: FORM_HEADERS,
    payload: form({ email, password }),
  });
  const sid = res.cookies.find((c) => c.name === 'sid');
  if (res.statusCode !== 303 || !sid) throw new Error(`login failed for ${email}: ${res.statusCode}`);
  return `sid=${sid.value}`;
}
