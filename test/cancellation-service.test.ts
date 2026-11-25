import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { cancelEvent, MSG_ALREADY_CANCELLED, MSG_ONLY_PUBLISHED_CANCELLABLE } from '../src/features/cancellation/service.js';
import {
  DomainError,
  getEventById,
  getOnSaleEvent,
  listOnSaleEvents,
  MSG_CANCELLED_NOT_EDITABLE,
  MSG_CANCELLED_NOT_PUBLISHABLE,
  MSG_EVENT_NOT_FOUND,
  publishEvent,
  updateEvent,
} from '../src/features/events/repo.js';
import { availableSeats } from '../src/features/events/seats.js';
import { processDueGatewayResponses } from '../src/features/purchases/gateway.js';
import { purchaseTicket, type PurchaseInput } from '../src/features/purchases/service.js';
import { getTicketById } from '../src/features/purchases/tickets.js';
import { resetDb, SEED } from './helpers.js';
import { countTickets, newEvent, sleep, userIdByEmail, waitForStatus } from './purchases-helpers.js';

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetDb();
});

const CARD_FAST_OK = '4000000000000001';
const CARD_SLOW_OK = '4000000000000003';
const buy = (eventId: string, cardNumber: string, patch: Partial<PurchaseInput> = {}) =>
  purchaseTicket({ eventId, buyerEmail: 'buyer@x.com', cardNumber, userId: null, channel: 'web', ...patch });

async function mustBuy(eventId: string, cardNumber: string): Promise<string> {
  const res = await buy(eventId, cardNumber);
  if (!res.ok) throw new Error(res.error);
  return res.ticket.id;
}

async function ticketStatuses(eventId: string): Promise<string[]> {
  const { rows } = await pool.query<{ status: string }>('SELECT status FROM tickets WHERE event_id = $1', [eventId]);
  return rows.map((r) => r.status);
}

/** Waits until every gateway answer of the event is due, then delivers them all (late answers). */
async function deliverAllGatewayAnswers(eventId: string): Promise<void> {
  const { rows } = await pool.query<{ ms: number | null }>(
    `SELECT (EXTRACT(EPOCH FROM max(g.respond_at) - now()) * 1000)::float8 AS ms
       FROM gateway_requests g JOIN tickets t ON t.id = g.ticket_id WHERE t.event_id = $1`,
    [eventId],
  );
  const wait = Number(rows[0]?.ms ?? 0);
  if (wait > 0) await sleep(wait + 50);
  while ((await processDueGatewayResponses()) > 0) {
    // drain every due answer
  }
  const { rows: left } = await pool.query(
    `SELECT 1 FROM gateway_requests g JOIN tickets t ON t.id = g.ticket_id
      WHERE t.event_id = $1 AND g.delivered_at IS NULL`,
    [eventId],
  );
  expect(left).toHaveLength(0);
}

const live = (statuses: string[]) => statuses.filter((s) => s === 'pending' || s === 'confirmed');

describe('cancelEvent (F06-AC1, F06-AC2, R11)', () => {
  it('confirmed → refunded, pending → cancelled, event cancelled', async () => {
    const orgA = await userIdByEmail(SEED.organizerA.email);
    const event = await newEvent({ capacity: 5 });
    const t5 = await mustBuy(event.id, CARD_SLOW_OK); // gateway answers only after 30–38 s (scaled)
    const t6 = await mustBuy(event.id, CARD_FAST_OK);
    expect((await waitForStatus(t6, processDueGatewayResponses)).status).toBe('confirmed');
    expect((await getTicketById(pool, t5))!.status).toBe('pending');

    expect(await cancelEvent(event.id, orgA)).toEqual({ ok: true, refunded: 1, cancelled: 1 });
    expect((await getTicketById(pool, t6))!.status).toBe('refunded');
    expect((await getTicketById(pool, t5))!.status).toBe('cancelled');
    const after = await getEventById(pool, event.id);
    expect(after!.status).toBe('cancelled');
    expect(after!.cancelledAt).toBeInstanceOf(Date);
  });

  it('a late gateway answer does not change cancelled/refunded tickets (F06-AC3, X11)', async () => {
    const orgA = await userIdByEmail(SEED.organizerA.email);
    const event = await newEvent({ capacity: 5 });
    const t5 = await mustBuy(event.id, CARD_SLOW_OK);
    const t6 = await mustBuy(event.id, CARD_FAST_OK);
    expect((await waitForStatus(t6, processDueGatewayResponses)).status).toBe('confirmed');
    expect((await cancelEvent(event.id, orgA)).ok).toBe(true);

    await deliverAllGatewayAnswers(event.id); // t5's approval arrives after the cancellation
    expect((await getTicketById(pool, t5))!.status).toBe('cancelled');
    expect((await getTicketById(pool, t6))!.status).toBe('refunded');
  });

  it('a draft cannot be cancelled', async () => {
    const orgA = await userIdByEmail(SEED.organizerA.email);
    const draft = await newEvent({}, { draft: true });
    expect(await cancelEvent(draft.id, orgA)).toEqual({ ok: false, message: MSG_ONLY_PUBLISHED_CANCELLABLE });
    expect((await getEventById(pool, draft.id))!.status).toBe('draft');
  });

  it('is irreversible: a second cancel is refused, publish and edit fail', async () => {
    const orgA = await userIdByEmail(SEED.organizerA.email);
    const event = await newEvent();
    expect(await cancelEvent(event.id, orgA)).toEqual({ ok: true, refunded: 0, cancelled: 0 });
    expect(await cancelEvent(event.id, orgA)).toEqual({ ok: false, message: MSG_ALREADY_CANCELLED });
    await expect(publishEvent(event.id, orgA)).rejects.toThrow(new DomainError(MSG_CANCELLED_NOT_PUBLISHABLE));
    await expect(
      updateEvent(event.id, orgA, {
        name: 'X',
        venue: 'Y',
        startsAt: new Date(Date.now() + 86_400_000),
        capacity: 10,
        priceCents: 100,
      }),
    ).rejects.toThrow(new DomainError(MSG_CANCELLED_NOT_EDITABLE));
    expect((await getEventById(pool, event.id))!.status).toBe('cancelled');
  });

  it('another organizer cannot cancel (R13): not found, event unchanged', async () => {
    const orgB = await userIdByEmail(SEED.organizerB.email);
    const event = await newEvent();
    await mustBuy(event.id, CARD_SLOW_OK);
    expect(await cancelEvent(event.id, orgB)).toEqual({ ok: false, message: MSG_EVENT_NOT_FOUND });
    expect(await cancelEvent('evt_nope', orgB)).toEqual({ ok: false, message: MSG_EVENT_NOT_FOUND });
    expect((await getEventById(pool, event.id))!.status).toBe('published');
    expect(await ticketStatuses(event.id)).toEqual(['pending']);
  });
});

describe('a cancelled event leaves the sale (X10, X11)', () => {
  it('off the showcase, purchase refused on both channels, 0 seats', async () => {
    const orgA = await userIdByEmail(SEED.organizerA.email);
    const event = await newEvent({ capacity: 5 });
    await mustBuy(event.id, CARD_FAST_OK);
    expect((await cancelEvent(event.id, orgA)).ok).toBe(true);

    expect((await listOnSaleEvents()).map((e) => e.id)).not.toContain(event.id);
    expect(await getOnSaleEvent(pool, event.id)).toBeNull();
    const before = await countTickets(event.id);
    expect(await buy(event.id, CARD_FAST_OK)).toEqual({ ok: false, error: 'event_not_available' });
    expect(await buy(event.id, CARD_FAST_OK, { channel: 'api' })).toEqual({ ok: false, error: 'event_not_available' });
    expect(await countTickets(event.id)).toBe(before);
    expect(await availableSeats(pool, (await getEventById(pool, event.id))!)).toBe(0);
  });
});

describe('race: cancellation × purchases (R07, R11)', () => {
  it('no pending/confirmed ticket survives a cancel running concurrently with 20 purchases', async () => {
    const orgA = await userIdByEmail(SEED.organizerA.email);
    const event = await newEvent({ capacity: 30 });
    const purchases = Array.from({ length: 20 }, (_, i) => buy(event.id, i % 2 ? CARD_FAST_OK : CARD_SLOW_OK));
    const cancel = cancelEvent(event.id, orgA);
    const [cancelRes, results] = await Promise.all([cancel, Promise.all(purchases)]);
    expect(cancelRes.ok).toBe(true);

    let bought = 0;
    for (const r of results) {
      if (r.ok) bought++;
      else expect(r.error).toBe('event_not_available');
    }
    expect(await countTickets(event.id)).toBe(bought);
    if (cancelRes.ok) expect(cancelRes.refunded + cancelRes.cancelled).toBe(bought);

    expect(live(await ticketStatuses(event.id))).toEqual([]);
    await deliverAllGatewayAnswers(event.id);
    expect(live(await ticketStatuses(event.id))).toEqual([]);
    expect((await getEventById(pool, event.id))!.status).toBe('cancelled');
  });
});
