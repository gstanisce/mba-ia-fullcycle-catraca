import type { FastifyReply, FastifyRequest } from 'fastify';
import { html } from '../../lib/html.js';
import { layout, type Role } from '../../lib/layout.js';

/** 403 page. Deliberately generic: it never shows any data of the requested resource. */
export function forbiddenPage(request: FastifyRequest): string {
  return layout({
    title: 'Acesso restrito',
    user: request.user,
    body: html`<h1>Acesso restrito</h1><p>Você não tem permissão para acessar esta página.</p>`,
  });
}

function requireRole(role: Role) {
  // Async hooks that answer early must `return reply` so Fastify stops the chain.
  return async function guard(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | undefined> {
    if (!request.user) return reply.redirect('/login', 302);
    if (request.user.role !== role) {
      return reply.code(403).type('text/html; charset=utf-8').send(forbiddenPage(request));
    }
    return undefined;
  };
}

/** preHandler: visitor → 302 /login; participant → 403 "Acesso restrito". */
export const requireOrganizer = requireRole('organizer');
/** preHandler: visitor → 302 /login; organizer → 403 "Acesso restrito". */
export const requireParticipant = requireRole('participant');
