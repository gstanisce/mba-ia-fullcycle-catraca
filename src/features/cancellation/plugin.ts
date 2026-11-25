import type { FastifyInstance } from 'fastify';
import { pool } from '../../db.js';
import { html } from '../../lib/html.js';
import { requireOrganizer } from '../auth/guards.js';
import { registerManagementSection, renderErrors, renderManagementPage, type ManagementSection } from '../events/management.js';
import { loadOwnedEvent, sendEventNotFound } from '../events/ownership.js';
import { MSG_EVENT_NOT_FOUND } from '../events/repo.js';
import { cancelEvent, MSG_ONLY_PUBLISHED_CANCELLABLE } from './service.js';

const MSG_CANCELLED_CONSEQUENCES = 'Ingressos confirmados foram estornados e pendentes foram cancelados.';

/** Result of a refused cancel POST, kept in `state.cancel`. */
export interface CancelSectionState {
  message: string;
}

/** Management-page section `Cancelamento` (order 90). */
export const cancelSection: ManagementSection = {
  id: 'cancel',
  title: 'Cancelamento',
  order: 90,
  render({ event, state }) {
    const st = state.cancel as CancelSectionState | undefined;
    const errors = renderErrors(st ? [st.message] : undefined);
    // `Evento cancelado` itself is shown once, by F02's edit section; here we only state the consequences.
    if (event.status === 'cancelled') return html`${errors}<p>${MSG_CANCELLED_CONSEQUENCES}</p>`;
    if (event.status !== 'published') return html`${errors}<p>${MSG_ONLY_PUBLISHED_CANCELLABLE}</p>`;
    return html`${errors}
<form method="post" action="/organizer/events/${event.id}/cancel" id="cancel-event">
<p>O cancelamento é irreversível: ingressos confirmados são estornados, pendentes são cancelados e o evento sai da vitrine.</p>
<button type="submit">Cancelar evento</button>
</form>`;
  },
};

/** F06: `Cancelamento` section + `POST /organizer/events/:id/cancel`. */
export function registerCancellationRoutes(app: FastifyInstance): void {
  registerManagementSection(cancelSection);

  app.post<{ Params: { id: string } }>('/organizer/events/:id/cancel', { preHandler: requireOrganizer }, async (request, reply) => {
    const event = await loadOwnedEvent(request, reply, request.params.id);
    if (!event) return reply;
    const result = await cancelEvent(event.id, request.user!.id);
    if (result.ok) return reply.redirect(`/organizer/events/${event.id}`, 303);
    if (result.message === MSG_EVENT_NOT_FOUND) return sendEventNotFound(request, reply);
    // Reload: the status may have changed while we waited for the lock.
    const fresh = await loadOwnedEvent(request, reply, event.id);
    if (!fresh) return reply;
    await renderManagementPage(reply, { event: fresh, user: request.user!, state: { cancel: { message: result.message } }, db: pool }, 422);
    return reply;
  });
}
