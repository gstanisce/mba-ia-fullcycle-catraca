import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { pool } from '../../db.js';
import { formatDateTime } from '../../lib/format.js';
import { html } from '../../lib/html.js';
import { layout } from '../../lib/layout.js';
import { requireParticipant } from '../auth/guards.js';
import { renderEventPage } from '../events/public-routes.js';
import { setPurchaseSlot, type PurchaseSlotContext } from '../events/purchase-slot.js';
import { getOnSaleEvent } from '../events/repo.js';
import { purchaseTicket } from './service.js';
import { listTicketsByUser, TICKET_STATUS_LABELS } from './tickets.js';

export const MSG_SOLD_OUT = 'Ingressos esgotados';
export const MSG_CARD_INVALID = 'O número do cartão deve ter 16 dígitos';
export const MSG_EVENT_NOT_AVAILABLE = 'Evento não disponível';
export const MSG_LOGIN_TO_BUY = 'Entre para comprar';
export const MSG_ONLY_PARTICIPANTS = 'Somente participantes compram ingressos';

/** F03's purchase slot on the public event page (F02). */
export function renderPurchaseArea({ event, user, available, message }: PurchaseSlotContext) {
  const soldOut = available <= 0;
  // On a sold-out page the sold-out notice itself already says it; avoid repeating it.
  const msg = message && !(soldOut && message === MSG_SOLD_OUT) ? html`<p class="error" role="alert">${message}</p>` : '';
  if (soldOut) return html`${msg}<p class="sold-out">${MSG_SOLD_OUT}</p>`;
  if (!user) return html`${msg}<p><a href="/login">${MSG_LOGIN_TO_BUY}</a></p>`;
  if (user.role !== 'participant') return html`${msg}<p>${MSG_ONLY_PARTICIPANTS}</p>`;
  return html`${msg}<form method="post" action="/events/${event.id}/purchase" id="purchase-form">
<label>Número do cartão (16 dígitos) <input name="cardNumber" inputmode="numeric" autocomplete="cc-number" maxlength="16" required></label>
<button type="submit">Comprar</button>
</form>`;
}

function sendEventNotAvailable(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return reply
    .code(404)
    .type('text/html; charset=utf-8')
    .send(
      layout({
        title: MSG_EVENT_NOT_AVAILABLE,
        user: request.user,
        body: html`<h1>${MSG_EVENT_NOT_AVAILABLE}</h1><p><a href="/">Voltar para a vitrine</a></p>`,
      }),
    );
}

function field(body: unknown, name: string): unknown {
  if (body && typeof body === 'object' && name in body) return (body as Record<string, unknown>)[name];
  return undefined;
}

/** F03 web routes: purchase slot, `POST /events/:id/purchase`, `GET /my-tickets`. */
export function registerPurchaseRoutes(app: FastifyInstance): void {
  setPurchaseSlot(renderPurchaseArea);

  app.post<{ Params: { id: string } }>('/events/:id/purchase', { preHandler: requireParticipant }, async (request, reply) => {
    const user = request.user!;
    const eventId = request.params.id;
    const result = await purchaseTicket({
      eventId,
      buyerEmail: user.email,
      cardNumber: field(request.body, 'cardNumber'),
      userId: user.id,
      channel: 'web',
    });
    if (result.ok) return reply.redirect('/my-tickets', 303);
    if (result.error === 'event_not_available') return sendEventNotAvailable(request, reply);
    // Re-render the event page with the message; if it stopped being on sale meanwhile, it is not available.
    const event = await getOnSaleEvent(pool, eventId);
    if (!event) return sendEventNotAvailable(request, reply);
    if (result.error === 'sold_out') return renderEventPage(reply, { event, user, message: MSG_SOLD_OUT, statusCode: 409 });
    return renderEventPage(reply, { event, user, message: MSG_CARD_INVALID, statusCode: 422 });
  });

  app.get('/my-tickets', { preHandler: requireParticipant }, async (request, reply) => {
    const user = request.user!;
    const tickets = await listTicketsByUser(pool, user.id);
    const body = tickets.length
      ? html`<table id="my-tickets">
<thead><tr><th>Evento</th><th>Data</th><th>Status</th><th>Código</th></tr></thead>
<tbody>
${tickets.map(
  (t) => html`<tr data-ticket-id="${t.id}"><td>${t.eventName}</td><td>${formatDateTime(t.eventStartsAt)}</td><td data-field="status">${TICKET_STATUS_LABELS[t.status]}</td><td data-field="code"><code>${t.code}</code></td></tr>
`,
)}</tbody>
</table>`
      : html`<p>Você ainda não tem ingressos.</p>`;
    return reply
      .type('text/html; charset=utf-8')
      .send(layout({ title: 'Meus ingressos', user, body: html`<h1>Meus ingressos</h1>\n${body}` }));
  });
}
