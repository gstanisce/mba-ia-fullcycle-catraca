import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { runSeed } from '../src/seed.js';
import { FORM_HEADERS, form, loginAs, resetDb, SEED } from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await resetDb();
});

const post = (url: string, fields: Record<string, string>, cookie?: string) =>
  app.inject({ method: 'POST', url, headers: { ...FORM_HEADERS, ...(cookie ? { cookie } : {}) }, payload: form(fields) });
const get = (url: string, cookie?: string) => app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

function sidCookie(res: Awaited<ReturnType<typeof post>>): string {
  const sid = res.cookies.find((c) => c.name === 'sid');
  if (!sid) throw new Error('no sid cookie');
  return `sid=${sid.value}`;
}

describe('signup (F01-AC1, F01-AC5)', () => {
  it('creates a logged-in participant and redirects to /', async () => {
    const res = await post('/signup', { name: 'Ana', email: 'Ana@X.com', password: 'segredo1' });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/');
    const sid = res.cookies.find((c) => c.name === 'sid')!;
    expect(sid.httpOnly).toBe(true);
    expect(sid.sameSite).toBe('Lax');
    expect(sid.path).toBe('/');
    expect(sid.value).toMatch(/^[0-9a-f]{64}$/);

    const home = await get('/', sidCookie(res));
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('Ana');
    expect(home.body).toContain('Sair');

    const { rows } = await pool.query("SELECT id, email, role, password_hash FROM users WHERE name = 'Ana'");
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toMatch(/^usr_[0-9a-z]{10}$/);
    expect(rows[0].email).toBe('ana@x.com');
    expect(rows[0].role).toBe('participant');
    expect(rows[0].password_hash).toMatch(/^scrypt\$/);
  });

  it('GET /signup renders the form', async () => {
    const res = await get('/signup');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('action="/signup"');
  });

  it('rejects a duplicate e-mail (case-insensitive) with 422', async () => {
    await post('/signup', { name: 'Ana', email: 'ana@x.com', password: 'segredo1' });
    const res = await post('/signup', { name: 'Outra', email: 'ANA@x.com', password: 'segredo2' });
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('E-mail já cadastrado');
    expect(res.cookies.find((c) => c.name === 'sid')).toBeUndefined();
    const { rows } = await pool.query("SELECT count(*) AS n FROM users WHERE email = 'ana@x.com'");
    expect(rows[0].n).toBe(1);
  });

  it('rejects a seed e-mail', async () => {
    const res = await post('/signup', { name: 'X', email: SEED.organizerA.email, password: 'segredo1' });
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('E-mail já cadastrado');
  });

  it.each([
    ['short password', { name: 'Ana', email: 'ana@x.com', password: '123' }],
    ['empty name', { name: '   ', email: 'ana@x.com', password: 'segredo1' }],
    ['invalid e-mail', { name: 'Ana', email: 'ana@x', password: 'segredo1' }],
    ['missing fields', {}],
  ])('rejects %s with 422 and the validation message', async (_label, fields) => {
    const res = await post('/signup', fields);
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('Informe nome, e-mail válido e senha com pelo menos 6 caracteres');
    const { rows } = await pool.query("SELECT count(*) AS n FROM users WHERE role = 'participant'");
    expect(rows[0].n).toBe(1); // only the seed participant
  });

  it('escapes user input echoed back in the form', async () => {
    const res = await post('/signup', { name: '<script>x</script>', email: 'bad', password: '1' });
    expect(res.body).not.toContain('<script>x</script>');
    expect(res.body).toContain('&lt;script&gt;');
  });

  it('ignores role=organizer: account is a participant and gets 403 on /organizer', async () => {
    const res = await post('/signup', { name: 'Eve', email: 'eve@x.com', password: 'segredo1', role: 'organizer' });
    expect(res.statusCode).toBe(303);
    const { rows } = await pool.query("SELECT role FROM users WHERE email = 'eve@x.com'");
    expect(rows[0].role).toBe('participant');

    const cookie = await loginAs(app, 'eve@x.com', 'segredo1');
    const org = await get('/organizer', cookie);
    expect(org.statusCode).toBe(403);
    expect(org.body).not.toContain('Área do organizador');
  });
});

describe('login and logout (F01-AC2)', () => {
  it.each([
    ['organizerA', '/organizer'],
    ['organizerB', '/organizer'],
    ['participant', '/'],
  ] as const)('seed account %s logs in and goes to %s', async (key, location) => {
    const res = await post('/login', { email: SEED[key].email, password: SEED[key].password });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe(location);
    const home = await get('/', sidCookie(res));
    expect(home.body).toContain(SEED[key].name);
  });

  it('signed-up account can log in again (e-mail case-insensitive)', async () => {
    await post('/signup', { name: 'Ana', email: 'ana@x.com', password: 'segredo1' });
    const res = await post('/login', { email: 'ANA@x.com', password: 'segredo1' });
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/');
  });

  it('GET /login renders the form', async () => {
    const res = await get('/login');
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('action="/login"');
  });

  it.each([
    ['wrong password', SEED.organizerA.email, 'errada'],
    ['unknown e-mail', 'ninguem@x.com', 'catraca123'],
    ['empty', '', ''],
  ])('rejects %s with 401', async (_label, email, password) => {
    const res = await post('/login', { email, password });
    expect(res.statusCode).toBe(401);
    expect(res.body).toContain('E-mail ou senha inválidos');
    expect(res.cookies.find((c) => c.name === 'sid')).toBeUndefined();
  });

  it('logout deletes the session; the old cookie no longer works', async () => {
    const cookie = await loginAs(app, SEED.organizerA.email, SEED.organizerA.password);
    expect((await get('/organizer', cookie)).statusCode).toBe(200);

    const out = await post('/logout', {}, cookie);
    expect(out.statusCode).toBe(303);
    expect(out.headers.location).toBe('/');
    const cleared = out.cookies.find((c) => c.name === 'sid');
    expect(cleared?.value).toBe('');

    const token = cookie.slice('sid='.length);
    const { rows } = await pool.query('SELECT 1 FROM sessions WHERE token = $1', [token]);
    expect(rows).toHaveLength(0);

    const after = await get('/organizer', cookie);
    expect(after.statusCode).toBe(302);
    expect(after.headers.location).toBe('/login');
    const home = await get('/', cookie);
    expect(home.body).toContain('Entrar');
    expect(home.body).not.toContain('Sair');
  });

  it('sessions expire after 7 days and expired sessions are ignored', async () => {
    const cookie = await loginAs(app, SEED.organizerA.email, SEED.organizerA.password);
    const token = cookie.slice('sid='.length);
    const { rows } = await pool.query(
      "SELECT expires_at - created_at = interval '7 days' AS ok FROM sessions WHERE token = $1",
      [token],
    );
    expect(rows[0].ok).toBe(true);

    await pool.query("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token = $1", [token]);
    const res = await get('/organizer', cookie);
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('unknown session token is treated as a visitor', async () => {
    const res = await get('/organizer', 'sid=deadbeef');
    expect(res.statusCode).toBe(302);
  });
});

describe('guards (F01-AC3, R13)', () => {
  it('visitor on /organizer is redirected to /login', async () => {
    const res = await get('/organizer');
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('/login');
  });

  it('participant on /organizer gets 403 without organizer data', async () => {
    const cookie = await loginAs(app, SEED.participant.email, SEED.participant.password);
    const res = await get('/organizer', cookie);
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain('Acesso restrito');
    expect(res.body).not.toContain('Área do organizador');
  });

  it('organizer A and B access /organizer', async () => {
    for (const acc of [SEED.organizerA, SEED.organizerB]) {
      const res = await get('/organizer', await loginAs(app, acc.email, acc.password));
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain('<h1>Área do organizador</h1>');
    }
  });

  it('requireParticipant: visitor 302, organizer 403, participant passes', async () => {
    const { requireParticipant } = await import('../src/features/auth/guards.js');
    const local = await buildApp();
    local.get('/only-participants', { preHandler: requireParticipant }, async () => 'secret-participant-data');
    try {
      const visitor = await local.inject({ method: 'GET', url: '/only-participants' });
      expect(visitor.statusCode).toBe(302);
      expect(visitor.headers.location).toBe('/login');

      const org = await local.inject({
        method: 'GET',
        url: '/only-participants',
        headers: { cookie: await loginAs(local, SEED.organizerA.email, SEED.organizerA.password) },
      });
      expect(org.statusCode).toBe(403);
      expect(org.body).toContain('Acesso restrito');
      expect(org.body).not.toContain('secret-participant-data');

      const part = await local.inject({
        method: 'GET',
        url: '/only-participants',
        headers: { cookie: await loginAs(local, SEED.participant.email, SEED.participant.password) },
      });
      expect(part.statusCode).toBe(200);
      expect(part.body).toBe('secret-participant-data');
    } finally {
      await local.close();
    }
  });
});

describe('seed (F01-AC4)', () => {
  it('creates the three accounts with the right roles', async () => {
    const { rows } = await pool.query('SELECT name, email, role FROM users ORDER BY email');
    expect(rows).toEqual([
      { name: 'Organizador A', email: 'org.a@catraca.dev', role: 'organizer' },
      { name: 'Organizador B', email: 'org.b@catraca.dev', role: 'organizer' },
      { name: 'Participante Seed', email: 'participante@catraca.dev', role: 'participant' },
    ]);
  });

  it('running the seed again does not fail nor duplicate, and keeps ids', async () => {
    const before = await pool.query('SELECT id, email FROM users ORDER BY email');
    await runSeed();
    await runSeed();
    const after = await pool.query('SELECT id, email FROM users ORDER BY email');
    expect(after.rows).toEqual(before.rows);
    expect(await loginAs(app, SEED.organizerA.email, SEED.organizerA.password)).toMatch(/^sid=/);
  });

  it('restores a seed account whose role or password was changed', async () => {
    await pool.query("UPDATE users SET role = 'participant', password_hash = 'x' WHERE email = $1", [
      SEED.organizerB.email,
    ]);
    await runSeed();
    const res = await get('/organizer', await loginAs(app, SEED.organizerB.email, SEED.organizerB.password));
    expect(res.statusCode).toBe(200);
  });
});
