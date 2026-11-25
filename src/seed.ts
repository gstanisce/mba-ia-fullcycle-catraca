import { pool } from './db.js';
import { newId } from './lib/ids.js';
import type { Role } from './lib/layout.js';
import { hashPassword } from './lib/password.js';

export interface SeedAccount {
  name: string;
  email: string;
  password: string;
  role: Role;
}

/** Fixed accounts created by the seed (organizers cannot sign up through the product). */
export const SEED_ACCOUNTS = {
  organizerA: { name: 'Organizador A', email: 'org.a@catraca.dev', password: 'catraca123', role: 'organizer' },
  organizerB: { name: 'Organizador B', email: 'org.b@catraca.dev', password: 'catraca123', role: 'organizer' },
  participant: { name: 'Participante Seed', email: 'participante@catraca.dev', password: 'catraca123', role: 'participant' },
} as const satisfies Record<string, SeedAccount>;

/** Idempotent seed: upserts every seed account by e-mail. Safe to run any number of times. */
export async function runSeed(): Promise<void> {
  for (const account of Object.values(SEED_ACCOUNTS)) {
    await pool.query(
      `INSERT INTO users (id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE
         SET name = EXCLUDED.name, role = EXCLUDED.role, password_hash = EXCLUDED.password_hash`,
      [newId('usr'), account.name, account.email, await hashPassword(account.password), account.role],
    );
  }
}
