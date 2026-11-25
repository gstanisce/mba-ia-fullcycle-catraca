// F04 — Partner API (fixed contract from the brief). Every route requires `X-Api-Key`.
// Reuses F02 (listOnSaleEvents, availableSeats) and F03 (purchaseTicket, getTicketById): no seat or purchase logic here.
import { timingSafeEqual } from 'node:crypto';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../../config.js';
import { pool } from '../../db.js';
import { toIsoWithOffset } from '../../lib/format.js';
import { availableSeats } from '../events/seats.js';
import { listOnSaleEvents } from '../events/repo.js';
import { purchaseTicket, type PurchaseError } from '../purchases/service.js';
import { getTicketById } from '../purchases/tickets.js';

/** HTTP status of each purchase error (contract order: 422 → 404 → 409, decided by `purchaseTicket`). */
const PURCHASE_ERROR_STATUS: Record<PurchaseError, number> = {
  invalid_request: 422,
  event_not_available: 404,
  sold_out: 409,
};

/** Constant-time key comparison; different lengths (or missing header) → invalid. */
export function isValidApiKey(given: unknown, expected: string = config.partnerApiKey): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Body parse failures (non-JSON, empty JSON body, unsupported media type…) → Fastify 400/415 errors. */
function isBodyParseError(err: Pick<FastifyError, 'code' | 'statusCode'>): boolean {
  return (typeof err.code === 'string' && err.code.startsWith('FST_ERR_CTP_')) || err.statusCode === 400 || err.statusCode === 415;
}

/** Fastify plugin; register with `{ prefix: '/api/partner' }`. Encapsulated: hook and error handler apply only here. */
export async function partnerApiPlugin(app: FastifyInstance): Promise<void> {
  // 401 before anything else (body parsing, validation, 404s of these routes).
  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isValidApiKey(request.headers['x-api-key'])) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  // Never answer 400/415 for a bad body: the contract says 422 invalid_request.
  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (isBodyParseError(err)) return reply.code(422).send({ error: 'invalid_request' });
    request.log.error(err);
    return reply.code(500).send({ error: 'internal_error' });
  });

  app.get('/events', async () => {
    const events = await listOnSaleEvents(pool);
    return Promise.all(
      events.map(async (e) => ({
        id: e.id,
        name: e.name,
        startsAt: toIsoWithOffset(e.startsAt),
        priceCents: e.priceCents,
        availableSeats: await availableSeats(pool, e),
      })),
    );
  });

  app.post<{ Params: { eventId: string } }>('/events/:eventId/purchases', async (request, reply) => {
    const raw = request.body;
    const body = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const result = await purchaseTicket({
      eventId: request.params.eventId,
      buyerEmail: body.buyerEmail,
      cardNumber: body.cardNumber,
      userId: null,
      channel: 'api',
    });
    if (!result.ok) return reply.code(PURCHASE_ERROR_STATUS[result.error]).send({ error: result.error });
    const { ticket } = result;
    return reply.code(202).send({ ticketId: ticket.id, code: ticket.code, status: ticket.status });
  });

  app.get<{ Params: { ticketId: string } }>('/tickets/:ticketId', async (request, reply) => {
    const ticket = await getTicketById(pool, request.params.ticketId);
    if (!ticket) return reply.code(404).send({ error: 'ticket_not_found' });
    return {
      ticketId: ticket.id,
      code: ticket.code,
      eventId: ticket.eventId,
      status: ticket.status,
      checkedIn: ticket.checkedInAt !== null,
    };
  });
}

export default partnerApiPlugin;
