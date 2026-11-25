// The single path that creates tickets (web and partner API). R06, R07, R03 snapshot, R09.
import type pg from 'pg';
import { withTransaction } from '../../db.js';
import { newId, newTicketCode } from '../../lib/ids.js';
import { mapEventRow } from '../events/repo.js';
import { computeAvailable, occupiedSeats } from '../events/seats.js';
import { requestAuthorization } from './gateway.js';
import { mapTicketRow, TICKET_COLUMNS, type TicketChannel, type TicketRow } from './tickets.js';

export interface PurchaseInput {
  eventId: string;
  buyerEmail: unknown;
  cardNumber: unknown;
  userId: string | null;
  channel: TicketChannel;
}

export type PurchaseError = 'invalid_request' | 'event_not_available' | 'sold_out';

export type PurchaseResult = { ok: true; ticket: TicketRow } | { ok: false; error: PurchaseError };

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const CARD_RE = /^\d{16}$/;

const MAX_CODE_ATTEMPTS = 5;

function isCodeCollision(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && e.constraint === 'tickets_code_key';
}

/** Inserts the ticket, retrying with a fresh code on a (very unlikely) code collision, via SAVEPOINT. */
async function insertTicket(
  client: pg.PoolClient,
  values: { eventId: string; priceCents: number; channel: TicketChannel; userId: string | null; buyerEmail: string; cardLast4: string },
): Promise<TicketRow> {
  for (let attempt = 1; ; attempt++) {
    await client.query('SAVEPOINT ticket_code');
    try {
      const { rows } = await client.query(
        `INSERT INTO tickets (id, event_id, code, status, price_cents, channel, user_id, buyer_email, card_last4)
         VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8)
         RETURNING ${TICKET_COLUMNS}`,
        [newId('tkt'), values.eventId, newTicketCode(), values.priceCents, values.channel, values.userId, values.buyerEmail, values.cardLast4],
      );
      await client.query('RELEASE SAVEPOINT ticket_code');
      return mapTicketRow(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT ticket_code');
      if (isCodeCollision(err) && attempt < MAX_CODE_ATTEMPTS) continue;
      throw err;
    }
  }
}

/**
 * Buys one ticket. Errors in this order: `invalid_request` (nothing written) → `event_not_available`
 * (missing, draft or cancelled) → `sold_out`. The event row is locked (`FOR UPDATE`) before counting seats,
 * which serializes every purchase of the same event (R07). Returns without waiting for the gateway (R06).
 */
export async function purchaseTicket(input: PurchaseInput): Promise<PurchaseResult> {
  const { buyerEmail, cardNumber } = input;
  if (typeof buyerEmail !== 'string' || !EMAIL_RE.test(buyerEmail) || typeof cardNumber !== 'string' || !CARD_RE.test(cardNumber)) {
    return { ok: false, error: 'invalid_request' };
  }
  if (typeof input.eventId !== 'string' || input.eventId === '') return { ok: false, error: 'event_not_available' };

  return withTransaction(async (client): Promise<PurchaseResult> => {
    const { rows } = await client.query('SELECT * FROM events WHERE id = $1 FOR UPDATE', [input.eventId]);
    const event = rows[0] ? mapEventRow(rows[0]) : null;
    if (!event || event.status !== 'published') return { ok: false, error: 'event_not_available' };

    // After the lock: in READ COMMITTED this sees every purchase committed before us.
    const occupied = await occupiedSeats(client, event.id);
    if (computeAvailable(event, occupied) <= 0) return { ok: false, error: 'sold_out' };

    const ticket = await insertTicket(client, {
      eventId: event.id,
      priceCents: event.priceCents, // R03 snapshot
      channel: input.channel,
      userId: input.userId,
      buyerEmail,
      cardLast4: cardNumber.slice(-4),
    });
    await requestAuthorization(client, ticket, cardNumber);
    return { ok: true, ticket };
  });
}
