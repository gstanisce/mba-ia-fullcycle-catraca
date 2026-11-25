import type { FastifyInstance, FastifyReply } from 'fastify';
import { pool } from '../../db.js';
import { html } from '../../lib/html.js';
import { newId } from '../../lib/ids.js';
import { layout, type SessionUser } from '../../lib/layout.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import {
  SESSION_COOKIE,
  createSession,
  deleteSession,
  findSessionUser,
  sessionCookieOptions,
} from './session.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export const MSG_EMAIL_TAKEN = 'E-mail já cadastrado';
export const MSG_SIGNUP_INVALID = 'Informe nome, e-mail válido e senha com pelo menos 6 caracteres';
export const MSG_LOGIN_INVALID = 'E-mail ou senha inválidos';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;
// Verified when the e-mail is unknown, so a miss costs about the same as a wrong password.
const DUMMY_HASH = await hashPassword('dummy-password-for-timing');

/** Reads one form field as a string ('' if missing or not a string). */
function field(body: unknown, name: string): string {
  if (body && typeof body === 'object' && name in body) {
    const v = (body as Record<string, unknown>)[name];
    if (typeof v === 'string') return v;
  }
  return '';
}

function sendHtml(reply: FastifyReply, status: number, page: string): FastifyReply {
  return reply.code(status).type('text/html; charset=utf-8').send(page);
}

function signupPage(user: SessionUser | null, values: { name: string; email: string }, error?: string): string {
  return layout({
    title: 'Criar conta',
    user,
    body: html`<h1>Criar conta</h1>
${error ? html`<p class="error" role="alert">${error}</p>` : ''}
<form method="post" action="/signup">
<label>Nome <input name="name" value="${values.name}" required></label>
<label>E-mail <input name="email" type="email" value="${values.email}" required></label>
<label>Senha <input name="password" type="password" minlength="6" required></label>
<button type="submit">Criar conta</button>
</form>
<p>Já tem conta? <a href="/login">Entrar</a></p>`,
  });
}

function loginPage(user: SessionUser | null, email: string, error?: string): string {
  return layout({
    title: 'Entrar',
    user,
    body: html`<h1>Entrar</h1>
${error ? html`<p class="error" role="alert">${error}</p>` : ''}
<form method="post" action="/login">
<label>E-mail <input name="email" type="email" value="${email}" required></label>
<label>Senha <input name="password" type="password" required></label>
<button type="submit">Entrar</button>
</form>
<p>Não tem conta? <a href="/signup">Criar conta</a></p>`,
  });
}

/**
 * Registers the session hook and the signup/login/logout routes on the ROOT instance
 * (no encapsulation), so `request.user` is available to every feature.
 */
export function registerAuth(app: FastifyInstance): void {
  app.decorateRequest('user', null);

  app.addHook('onRequest', async (request) => {
    request.user = null;
    const token = request.cookies[SESSION_COOKIE];
    if (token) request.user = await findSessionUser(token);
  });

  app.get('/signup', async (request, reply) => sendHtml(reply, 200, signupPage(request.user, { name: '', email: '' })));

  app.post('/signup', async (request, reply) => {
    const name = field(request.body, 'name').trim();
    const email = field(request.body, 'email').trim().toLowerCase();
    const password = field(request.body, 'password');
    // Any `role` field is ignored on purpose: signup always creates a participant.
    if (!name || !EMAIL_RE.test(email) || password.length < MIN_PASSWORD) {
      return sendHtml(reply, 422, signupPage(request.user, { name, email }, MSG_SIGNUP_INVALID));
    }
    const passwordHash = await hashPassword(password);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO users (id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, 'participant')
       ON CONFLICT (email) DO NOTHING
       RETURNING id`,
      [newId('usr'), name, email, passwordHash],
    );
    const created = rows[0];
    if (!created) return sendHtml(reply, 422, signupPage(request.user, { name, email }, MSG_EMAIL_TAKEN));
    const token = await createSession(created.id);
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions);
    return reply.redirect('/', 303);
  });

  app.get('/login', async (request, reply) => sendHtml(reply, 200, loginPage(request.user, '')));

  app.post('/login', async (request, reply) => {
    const email = field(request.body, 'email').trim().toLowerCase();
    const password = field(request.body, 'password');
    const { rows } = await pool.query<{ id: string; role: string; password_hash: string }>(
      'SELECT id, role, password_hash FROM users WHERE email = $1',
      [email],
    );
    const user = rows[0];
    const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok) return sendHtml(reply, 401, loginPage(request.user, email, MSG_LOGIN_INVALID));
    const token = await createSession(user.id);
    reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions);
    return reply.redirect(user.role === 'organizer' ? '/organizer' : '/', 303);
  });

  app.post('/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSession(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.redirect('/', 303);
  });
}
