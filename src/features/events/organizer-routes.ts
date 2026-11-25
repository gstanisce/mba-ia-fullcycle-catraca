import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { pool } from '../../db.js';
import { formatDateTime } from '../../lib/format.js';
import { html } from '../../lib/html.js';
import { layout, type SessionUser } from '../../lib/layout.js';
import { requireOrganizer } from '../auth/guards.js';
import { renderEventFields, renderErrors, renderManagementPage, type EditSectionState } from './management.js';
import { loadOwnedEvent } from './ownership.js';
import {
  createEvent,
  DomainError,
  EVENT_STATUS_LABELS,
  listEventsByOrganizer,
  MSG_CANCELLED_NOT_EDITABLE,
  publishEvent,
  updateEvent,
  type EventRow,
} from './repo.js';
import { readEventForm, validateEventForm, type EventFormValues } from './validation.js';

type IdRoute = { Params: { id: string } };

const EMPTY_FORM: EventFormValues = { name: '', startsAt: '', venue: '', capacity: '', price: '' };

function newEventPage(user: SessionUser, values: EventFormValues, errors?: string[]): string {
  return layout({
    title: 'Novo evento',
    user,
    body: html`<h1>Novo evento</h1>
${renderErrors(errors)}
<form method="post" action="/organizer/events" id="new-event">
${renderEventFields(values)}
<button type="submit">Criar evento</button>
</form>
<p><a href="/organizer">Voltar para a área do organizador</a></p>`,
  });
}

function organizerHomePage(user: SessionUser, events: EventRow[]): string {
  const table = events.length
    ? html`<table id="my-events">
<thead><tr><th>Evento</th><th>Data</th><th>Status</th></tr></thead>
<tbody>
${events.map(
  (e) => html`<tr data-event-id="${e.id}"><td><a href="/organizer/events/${e.id}">${e.name}</a></td><td>${formatDateTime(e.startsAt)}</td><td>${EVENT_STATUS_LABELS[e.status]}</td></tr>
`,
)}</tbody>
</table>`
    : html`<p>Você ainda não tem eventos.</p>`;
  return layout({
    title: 'Área do organizador',
    user,
    body: html`<h1>Área do organizador</h1>
<p><a href="/organizer/events/new">Novo evento</a></p>
${table}`,
  });
}

/** Re-renders the management page with the edit section's errors (422). */
async function renderEditError(
  request: FastifyRequest,
  reply: FastifyReply,
  event: EventRow,
  edit: EditSectionState,
): Promise<FastifyReply> {
  await renderManagementPage(reply, { event, user: request.user!, state: { edit }, db: pool }, 422);
  return reply;
}

/** F02 organizer area: list, create, management page, edit, publish. All behind `requireOrganizer`. */
export function registerOrganizerEventRoutes(app: FastifyInstance): void {
  app.get('/organizer', { preHandler: requireOrganizer }, async (request, reply) => {
    const user = request.user!;
    const events = await listEventsByOrganizer(pool, user.id);
    return reply.type('text/html; charset=utf-8').send(organizerHomePage(user, events));
  });

  app.get('/organizer/events/new', { preHandler: requireOrganizer }, async (request, reply) =>
    reply.type('text/html; charset=utf-8').send(newEventPage(request.user!, EMPTY_FORM)),
  );

  app.post('/organizer/events', { preHandler: requireOrganizer }, async (request, reply) => {
    const user = request.user!;
    const values = readEventForm(request.body);
    const result = validateEventForm(values);
    if (!result.ok) return reply.code(422).type('text/html; charset=utf-8').send(newEventPage(user, values, result.errors));
    try {
      const event = await createEvent({ ...result.value, organizerId: user.id });
      return reply.redirect(`/organizer/events/${event.id}`, 303);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      return reply.code(422).type('text/html; charset=utf-8').send(newEventPage(user, values, [err.message]));
    }
  });

  app.get<IdRoute>('/organizer/events/:id', { preHandler: requireOrganizer }, async (request, reply) => {
    const event = await loadOwnedEvent(request, reply, request.params.id);
    if (!event) return reply;
    await renderManagementPage(reply, { event, user: request.user!, state: {}, db: pool });
    return reply;
  });

  app.post<IdRoute>('/organizer/events/:id', { preHandler: requireOrganizer }, async (request, reply) => {
    const event = await loadOwnedEvent(request, reply, request.params.id);
    if (!event) return reply;
    if (event.status === 'cancelled') return renderEditError(request, reply, event, { errors: [MSG_CANCELLED_NOT_EDITABLE] });
    const values = readEventForm(request.body);
    const result = validateEventForm(values);
    if (!result.ok) return renderEditError(request, reply, event, { errors: result.errors, values });
    try {
      await updateEvent(event.id, request.user!.id, result.value);
      return reply.redirect(`/organizer/events/${event.id}`, 303);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      // Reload: the row may have changed (e.g. cancelled) while we waited for the lock.
      const fresh = await loadOwnedEvent(request, reply, event.id);
      if (!fresh) return reply;
      return renderEditError(request, reply, fresh, { errors: [err.message], values });
    }
  });

  app.post<IdRoute>('/organizer/events/:id/publish', { preHandler: requireOrganizer }, async (request, reply) => {
    const event = await loadOwnedEvent(request, reply, request.params.id);
    if (!event) return reply;
    try {
      await publishEvent(event.id, request.user!.id);
      return reply.redirect(`/organizer/events/${event.id}`, 303);
    } catch (err) {
      if (!(err instanceof DomainError)) throw err;
      const fresh = await loadOwnedEvent(request, reply, event.id);
      if (!fresh) return reply;
      return renderEditError(request, reply, fresh, { errors: [err.message] });
    }
  });
}
