import type { FastifyInstance, FastifyReply } from 'fastify';
import { pool } from '../../db.js';
import { formatBRL, formatDateTime } from '../../lib/format.js';
import { html, raw } from '../../lib/html.js';
import { layout, type SessionUser } from '../../lib/layout.js';
import { sendEventNotFound } from './ownership.js';
import { renderPurchaseSlot } from './purchase-slot.js';
import { getOnSaleEvent, listOnSaleEvents, type EventRow } from './repo.js';
import { availableSeats } from './seats.js';

export interface EventPageOptions {
  event: EventRow;
  user: SessionUser | null;
  /** Passed to the purchase slot (e.g. `Ingressos esgotados`). */
  message?: string;
  statusCode?: number;
}

/**
 * Renders the public page of an on-sale event: name, date, venue, price, `Vagas disponíveis: N` and the purchase slot.
 * F03 reuses it to re-render after a failed purchase (`message`, `statusCode`).
 */
export async function renderEventPage(reply: FastifyReply, opts: EventPageOptions): Promise<FastifyReply> {
  const { event, user, message } = opts;
  const available = await availableSeats(pool, event);
  const slot = renderPurchaseSlot({ event, user, available, ...(message !== undefined ? { message } : {}) });
  const body = html`<h1>${event.name}</h1>
<dl class="event-summary">
<dt>Data</dt><dd data-field="startsAt">${formatDateTime(event.startsAt)}</dd>
<dt>Local</dt><dd data-field="venue">${event.venue}</dd>
<dt>Preço</dt><dd data-field="price">${formatBRL(event.priceCents)}</dd>
</dl>
<p id="available-seats">Vagas disponíveis: ${available}</p>
<div id="purchase-slot">${raw(slot)}</div>
<p><a href="/">Voltar para a vitrine</a></p>`;
  return reply
    .code(opts.statusCode ?? 200)
    .type('text/html; charset=utf-8')
    .send(layout({ title: event.name, user, body }));
}

/** F02 public showcase: `/` (events on sale) and `/events/:id`. */
export function registerPublicEventRoutes(app: FastifyInstance): void {
  app.get('/', async (request, reply) => {
    const events = await listOnSaleEvents(pool);
    const list = events.length
      ? html`<ul id="events">
${events.map(
  (e) => html`<li data-event-id="${e.id}"><a href="/events/${e.id}">${e.name}</a> · ${formatDateTime(e.startsAt)} · ${e.venue} · ${formatBRL(e.priceCents)}</li>
`,
)}</ul>`
      : html`<p>Nenhum evento à venda no momento.</p>`;
    return reply
      .type('text/html; charset=utf-8')
      .send(layout({ title: 'Vitrine', user: request.user, body: html`<h1>Vitrine</h1>\n${list}` }));
  });

  app.get<{ Params: { id: string } }>('/events/:id', async (request, reply) => {
    const event = await getOnSaleEvent(pool, request.params.id);
    if (!event) return sendEventNotFound(request, reply);
    return renderEventPage(reply, { event, user: request.user });
  });
}
