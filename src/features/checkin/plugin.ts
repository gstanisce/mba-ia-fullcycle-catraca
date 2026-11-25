import type { FastifyInstance } from 'fastify';
import { pool } from '../../db.js';
import { html } from '../../lib/html.js';
import { requireOrganizer } from '../auth/guards.js';
import { registerManagementSection, renderManagementPage, type ManagementSection } from '../events/management.js';
import { loadOwnedEvent } from '../events/ownership.js';
import { checkIn, type CheckinResult } from './service.js';

/** Result of the check-in POST, kept in `state.checkin`. */
export interface CheckinSectionState {
  result: CheckinResult;
  message: string;
}

/** F05 section of the management page: code field + `Validar`; shows the last result. */
export const checkinSection: ManagementSection = {
  id: 'checkin',
  title: 'Check-in',
  order: 20,
  render({ event, state }) {
    const st = state.checkin as CheckinSectionState | undefined;
    return html`<form method="post" action="/organizer/events/${event.id}/checkin" id="checkin-form">
<label>Código do ingresso <input name="code" autocomplete="off" required></label>
<button type="submit">Validar</button>
</form>
${st ? html`<p id="checkin-result" data-result="${st.result}">${st.message}</p>` : ''}`;
  },
};

/** F05: check-in section + `POST /organizer/events/:id/checkin` (organizer and owner only). */
export function registerCheckin(app: FastifyInstance): void {
  registerManagementSection(checkinSection);

  app.post<{ Params: { id: string }; Body: { code?: unknown } }>(
    '/organizer/events/:id/checkin',
    { preHandler: requireOrganizer },
    async (request, reply) => {
      const event = await loadOwnedEvent(request, reply, request.params.id);
      if (!event) return reply;
      const checkin = await checkIn(event.id, request.body?.code);
      await renderManagementPage(reply, { event, user: request.user!, state: { checkin }, db: pool });
      return reply;
    },
  );
}
