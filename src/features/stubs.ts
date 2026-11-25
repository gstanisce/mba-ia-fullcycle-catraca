// Temporary pages owned by F01. F02 deletes this whole file (and its line in src/app.ts).
import type { FastifyInstance } from 'fastify';
import { html } from '../lib/html.js';
import { layout } from '../lib/layout.js';
import { requireOrganizer } from './auth/guards.js';

export function registerStubs(app: FastifyInstance): void {
  app.get('/', async (request, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .send(layout({ title: 'Vitrine', user: request.user, body: html`<h1>Vitrine</h1>` })),
  );

  app.get('/organizer', { preHandler: requireOrganizer }, async (request, reply) =>
    reply
      .type('text/html; charset=utf-8')
      .send(layout({ title: 'Área do organizador', user: request.user, body: html`<h1>Área do organizador</h1>` })),
  );
}
