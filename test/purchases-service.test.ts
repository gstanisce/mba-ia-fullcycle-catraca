import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { capacityBelowOccupiedMessage, DomainError, updateEvent } from '../src/features/events/repo.js';
import { availableSeats, occupiedSeats } from '../src/features/events/seats.js';
import { processDueGatewayResponses } from '../src/features/purchases/gateway.js';
import { purchaseTicket, type PurchaseInput } from '../src/features/purchases/service.js';
import { findTicketByCode, getTicketById, TICKET_STATUS_LABELS } from '../src/features/purchases/tickets.js';
import { TICKET_CODE_ALPHABET } from '../src/lib/ids.js';
import { resetDb, SEED } from './helpers.js';
import { countTickets, newEvent, userIdByEmail, waitForStatus } from './purchases-helpers.js';

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetDb();
});

const CARD_OK = '4000000000000001';
const buy = (eventId: string, patch: Partial<PurchaseInput> = {}) =>
  purchaseTicket({ eventId, buyerEmail: 'buyer@x.com', cardNumber: CARD_OK, userId: null, channel: 'api', ...patch });

describe('purchaseTicket creates a pending ticket (R06, R09, F03-AC1)', () => {
  it('returns at once with a pending ticket, price snapshot, 8-char code and card last 4', async () => {
    const event = await newEvent({ priceCents: 12345 });
    const userId = await userIdByEmail(SEED.participant.email);
    const started = Date.now();
    const res = await buy(event.id, { userId, channel: 'web', buyerEmail: SEED.participant.email });
    expect(Date.now() - started).toBeLessThan(1000);
    if (!res.ok) throw new Error(res.error);
    const t = res.ticket;
    expect(t.id).toMatch(/^tkt_[0-9a-z]{10}$/);
    expect(t.status).toBe('pending');
    expect(t.eventId).toBe(event.id);
    expect(t.priceCents).toBe(12345);
    expect(t.channel).toBe('web');
    expect(t.userId).toBe(userId);
    expect(t.buyerEmail).toBe(SEED.participant.email);
    expect(t.cardLast4).toBe('0001');
    expect(t.checkedInAt).toBeNull();
    expect(t.code).toHaveLength(8);
    for (const ch of t.code) expect(TICKET_CODE_ALPHABET).toContain(ch);
    expect(await getTicketById(pool, t.id)).toEqual(t);
    expect(await findTicketByCode(pool, t.code)).toEqual(t);
    expect(await getTicketById(pool, 'tkt_nope')).toBeNull();
    expect(await findTicketByCode(pool, 'NOPE1234')).toBeNull();
  });

  it('status labels', () => {
    expect(TICKET_STATUS_LABELS).toEqual({
      pending: 'pendente',
      confirmed: 'confirmado',
      declined: 'recusado',
      cancelled: 'cancelado',
      refunded: 'estornado',
    });
  });

  it('codes are unique across many purchases', async () => {
    const event = await newEvent({ capacity: 200 });
    for (let i = 0; i < 100; i++) expect((await buy(event.id)).ok).toBe(true);
    const { rows } = await pool.query('SELECT count(DISTINCT code) AS d, count(*) AS n FROM tickets');
    expect(rows[0].d).toBe(rows[0].n);
    expect(rows[0].n).toBe(100);
  });
});

describe('validation order invalid_request → event_not_available → sold_out (F03-AC3, X03)', () => {
  const badCards: unknown[] = ['123', '400000000000000', '40000000000000012', '4000 0000 0000 0001', 'abcdabcdabcdabcd', '', undefined, 4000000000000001];
  it.each(badCards)('card %s → invalid_request, nothing written', async (cardNumber) => {
    const event = await newEvent();
    expect(await buy(event.id, { cardNumber })).toEqual({ ok: false, error: 'invalid_request' });
    expect(await countTickets()).toBe(0);
    const { rows } = await pool.query('SELECT count(*) AS n FROM gateway_requests');
    expect(rows[0].n).toBe(0);
  });

  const badEmails: unknown[] = ['', 'nope', 'a@b', 'a b@c.com', undefined, 42];
  it.each(badEmails)('e-mail %s → invalid_request', async (buyerEmail) => {
    const event = await newEvent();
    expect(await buy(event.id, { buyerEmail })).toEqual({ ok: false, error: 'invalid_request' });
    expect(await countTickets()).toBe(0);
  });

  it('invalid request wins over a missing / sold-out event', async () => {
    expect(await buy('evt_missing000', { cardNumber: '1' })).toEqual({ ok: false, error: 'invalid_request' });
    const event = await newEvent({ capacity: 1 });
    expect((await buy(event.id)).ok).toBe(true);
    expect(await buy(event.id, { cardNumber: '1' })).toEqual({ ok: false, error: 'invalid_request' });
  });

  it('missing, draft and cancelled events → event_not_available (even when also sold out)', async () => {
    expect(await buy('evt_missing000')).toEqual({ ok: false, error: 'event_not_available' });
    const draft = await newEvent({}, { draft: true });
    expect(await buy(draft.id)).toEqual({ ok: false, error: 'event_not_available' });
    const cancelled = await newEvent({ capacity: 1 });
    expect((await buy(cancelled.id)).ok).toBe(true);
    await pool.query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [cancelled.id]);
    expect(await buy(cancelled.id)).toEqual({ ok: false, error: 'event_not_available' });
    expect(await countTickets(draft.id)).toBe(0);
    expect(await countTickets(cancelled.id)).toBe(1);
  });

  it('full event → sold_out; nothing written', async () => {
    const event = await newEvent({ capacity: 2 });
    expect((await buy(event.id)).ok).toBe(true);
    expect((await buy(event.id)).ok).toBe(true);
    expect(await buy(event.id)).toEqual({ ok: false, error: 'sold_out' });
    expect(await countTickets(event.id)).toBe(2);
  });
});

describe('pending holds a seat; refusal frees it (R05/R06/R08, F03-AC4)', () => {
  it('0002 is sold out while pending, then declined frees the seat', async () => {
    const event = await newEvent({ capacity: 1 });
    const first = await buy(event.id, { cardNumber: '4000000000000002' });
    if (!first.ok) throw new Error(first.error);
    expect(await buy(event.id)).toEqual({ ok: false, error: 'sold_out' });
    expect(await availableSeats(pool, event)).toBe(0);
    expect((await waitForStatus(first.ticket.id, processDueGatewayResponses)).status).toBe('declined');
    expect(await availableSeats(pool, event)).toBe(1);
    expect((await buy(event.id)).ok).toBe(true);
  });
});

describe('concurrency: 30 simultaneous purchases on capacity 5 (R07, F03-AC6, C03-07)', () => {
  const ROUNDS = 5;
  it(`exactly 5 succeed and 25 get sold_out, in ${ROUNDS} rounds on fresh events`, async () => {
    for (let round = 1; round <= ROUNDS; round++) {
      const event = await newEvent({ capacity: 5, name: `Carga ${round}` });
      const results = await Promise.all(
        Array.from({ length: 30 }, (_, i) => buy(event.id, { buyerEmail: `b${round}-${i}@x.com` })),
      );
      const ok = results.filter((r) => r.ok).length;
      const soldOut = results.filter((r) => !r.ok && r.error === 'sold_out').length;
      expect({ round, ok, soldOut }).toEqual({ round, ok: 5, soldOut: 25 });
      expect(await occupiedSeats(pool, event.id)).toBe(5);
      expect(await countTickets(event.id)).toBe(5);
    }
  });
});

describe('price snapshot (R03, F03-AC8, C03-10)', () => {
  it('buy at R$100, change price to R$150, buy again → 10000 and 15000; old ticket unchanged', async () => {
    const event = await newEvent({ priceCents: 10000, capacity: 5 });
    const first = await buy(event.id);
    await updateEvent(event.id, event.organizerId, {
      name: event.name,
      venue: event.venue,
      startsAt: event.startsAt,
      capacity: event.capacity,
      priceCents: 15000,
    });
    const second = await buy(event.id);
    if (!first.ok || !second.ok) throw new Error('purchase failed');
    const { rows } = await pool.query('SELECT id, price_cents FROM tickets WHERE event_id = $1', [event.id]);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.price_cents]));
    expect(byId).toEqual({ [first.ticket.id]: 10000, [second.ticket.id]: 15000 });
  });
});

describe('F03 purchases count in F02 seats (X04, C03-14)', () => {
  it('1 pending + 1 confirmed: capacity 1 rejected, 3 accepted', async () => {
    const event = await newEvent({ capacity: 2 });
    const pending = await buy(event.id, { cardNumber: '4000000000000003' });
    const confirmed = await buy(event.id, { cardNumber: '4000000000000001' });
    if (!pending.ok || !confirmed.ok) throw new Error('purchase failed');
    expect((await waitForStatus(confirmed.ticket.id, processDueGatewayResponses)).status).toBe('confirmed');
    expect((await getTicketById(pool, pending.ticket.id))!.status).toBe('pending');
    const input = { name: event.name, venue: event.venue, startsAt: event.startsAt, priceCents: event.priceCents };
    const err = await updateEvent(event.id, event.organizerId, { ...input, capacity: 1 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DomainError);
    expect((err as Error).message).toBe(capacityBelowOccupiedMessage(2));
    expect((await updateEvent(event.id, event.organizerId, { ...input, capacity: 3 })).capacity).toBe(3);
  });
});
