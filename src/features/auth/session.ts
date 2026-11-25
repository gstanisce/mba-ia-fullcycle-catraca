import { randomBytes } from 'node:crypto';
import { pool } from '../../db.js';
import type { SessionUser } from '../../lib/layout.js';

export const SESSION_COOKIE = 'sid';
export const SESSION_TTL_DAYS = 7;

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
} as const;

/** Creates a session row and returns its token (32 random bytes, hex). */
export async function createSession(userId: string): Promise<string> {
  const token = randomBytes(32).toString('hex');
  await pool.query(
    `INSERT INTO sessions (token, user_id, expires_at) VALUES ($1, $2, now() + make_interval(days => $3))`,
    [token, userId, SESSION_TTL_DAYS],
  );
  return token;
}

/** Loads the user of a non-expired session, or null. */
export async function findSessionUser(token: string): Promise<SessionUser | null> {
  const { rows } = await pool.query<SessionUser>(
    `SELECT u.id, u.name, u.email, u.role
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > now()`,
    [token],
  );
  return rows[0] ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE token = $1', [token]);
}
