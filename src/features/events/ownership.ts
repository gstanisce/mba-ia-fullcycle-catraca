import type { FastifyReply, FastifyRequest } from 'fastify';
import { pool } from '../../db.js';
import { html } from '../../lib/html.js';
import { layout } from '../../lib/layout.js';
import { getEventById, MSG_EVENT_NOT_FOUND, type EventRow } from './repo.js';

/** Sends the generic 404 "Evento não encontrado" page. It never shows any data of the requested event. */
export function sendEventNotFound(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply
    .code(404)
    .type('text/html; charset=utf-8')
    .send(
      layout({
        title: MSG_EVENT_NOT_FOUND,
        user: request.user,
        body: html`<h1>${MSG_EVENT_NOT_FOUND}</h1><p><a href="/">Voltar para a vitrine</a></p>`,
      }),
    );
}

/**
 * Loads an event owned by the logged-in user (R13). If it does not exist OR belongs to someone else,
 * answers 404 "Evento não encontrado" (no name, numbers or tickets) and returns null — the caller must then
 * `return reply`. Every `/organizer/events/:id*` route, of any feature, uses this (after `requireOrganizer`).
 */
export async function loadOwnedEvent(request: FastifyRequest, reply: FastifyReply, id: string): Promise<EventRow | null> {
  const event = await getEventById(pool, id);
  if (!event || !request.user || event.organizerId !== request.user.id) {
    sendEventNotFound(request, reply);
    return null;
  }
  return event;
}
