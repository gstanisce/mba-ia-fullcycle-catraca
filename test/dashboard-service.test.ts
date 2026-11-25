import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { cancelEvent } from '../src/features/cancellation/service.js';
import { checkIn } from '../src/features/checkin/service.js';
import { getDashboard, type Dashboard } from '../src/features/dashboard/service.js';
import { getEventById, updateEvent } from '../src/features/events/repo.js';
import { processDueGatewayResponses } from '../src/features/purchases/gateway.js';
import { purchaseTicket } from '../src/features/purchases/service.js';
import { getTicketById, type TicketChannel, type TicketRow } from '../src/features/purchases/tickets.js';
import { resetDb, SEED } from './helpers.js';
import { newEvent, userIdByEmail, waitForStatus } from './purchases-helpers.js';

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetDb();
});

const CARD_OK = '4000000000000001';
const CARD_SLOW_OK = '4000000000000003';
const CARD_SLOW_DECLINED = '4000000000000004';

/** Buys through F03's single purchase path (web tickets belong to the seed participant). */
async function buy(eventId: string, channel: TicketChannel, cardNumber: string): Promise<TicketRow> {
  const userId = channel === 'web' ? await userIdByEmail(SEED.participant.email) : null;
  const res = await purchaseTicket({ eventId, buyerEmail: SEED.participant.email, cardNumber, userId, channel });
  if (!res.ok) throw new Error(res.error);
  return res.ticket;
}

/** Waits for the (scaled) gateway answer and returns the final status. */
async function settle(ticketId: string): Promise<string> {
  return (await waitForStatus(ticketId, processDueGatewayResponses, 10_000)).status;
}

async function dashboardOf(eventId: string): Promise<Dashboard> {
  const event = await getEventById(pool, eventId);
  return getDashboard(pool, event!);
}

const holdPending = (ticketId: string) =>
  pool.query("UPDATE gateway_requests SET respond_at = now() + interval '1 hour' WHERE ticket_id = $1", [ticketId]);

/** Step 9 of the evaluator flow: E1 (capacity 2, R$ 100) → 3 confirmed, R$ 350,00. Returns the web ticket. */
async function step9(): Promise<{ eventId: string; webTicket: TicketRow }> {
  const orgA = await userIdByEmail(SEED.organizerA.email);
  const e1 = await newEvent({ capacity: 2, priceCents: 10000 });

  const web = await buy(e1.id, 'web', CARD_OK);
  expect(await settle(web.id)).toBe('confirmed');

  const t2 = await buy(e1.id, 'api', CARD_SLOW_DECLINED);
  expect(await dashboardOf(e1.id)).toMatchObject({ confirmed: 1, pending: 1, available: 0, revenueCents: 10000 });
  expect(await settle(t2.id)).toBe('declined');

  const t3 = await buy(e1.id, 'api', CARD_OK);
  expect(await settle(t3.id)).toBe('confirmed');

  await updateEvent(e1.id, orgA, { name: e1.name, venue: e1.venue, startsAt: e1.startsAt, capacity: 3, priceCents: 15000 });
  const t4 = await buy(e1.id, 'api', CARD_OK);
  expect(t4.priceCents).toBe(15000);
  expect(await settle(t4.id)).toBe('confirmed');
  return { eventId: e1.id, webTicket: (await getTicketById(pool, web.id))! };
}

describe('getDashboard (F07-AC2, R12)', () => {
  it('new event: everything zero, available = capacity', async () => {
    const e = await newEvent({ capacity: 4 });
    expect(await dashboardOf(e.id)).toEqual({ confirmed: 0, pending: 0, checkins: 0, available: 4, revenueCents: 0, refunded: 0 });
  });

  it('step 9: web + API sales, price recorded per ticket → 3/0/0/0/R$ 350,00/0 (X13)', async () => {
    const { eventId } = await step9();
    expect(await dashboardOf(eventId)).toEqual({
      confirmed: 3,
      pending: 0,
      checkins: 0,
      available: 0,
      revenueCents: 35000,
      refunded: 0,
    });
  });

  it('a check-in raises Check-ins to 1 and keeps Confirmados (X14)', async () => {
    const { eventId, webTicket } = await step9();
    expect((await checkIn(eventId, webTicket.code)).result).toBe('admitted');
    expect(await dashboardOf(eventId)).toMatchObject({ confirmed: 3, checkins: 1, available: 0, revenueCents: 35000 });
    // a second attempt (already used) changes nothing
    expect((await checkIn(eventId, webTicket.code)).result).toBe('already_used');
    expect(await dashboardOf(eventId)).toMatchObject({ confirmed: 3, checkins: 1 });
  });

  it('cancel with 1 confirmed + 1 pending → 0/0/0/0/R$ 0,00/1 (X15)', async () => {
    const orgA = await userIdByEmail(SEED.organizerA.email);
    const e3 = await newEvent({ capacity: 5, priceCents: 5000 });
    const t5 = await buy(e3.id, 'api', CARD_SLOW_OK);
    await holdPending(t5.id);
    const t6 = await buy(e3.id, 'api', CARD_OK);
    expect(await settle(t6.id)).toBe('confirmed');
    expect(await dashboardOf(e3.id)).toEqual({ confirmed: 1, pending: 1, checkins: 0, available: 3, revenueCents: 5000, refunded: 0 });

    expect(await cancelEvent(e3.id, orgA)).toEqual({ ok: true, refunded: 1, cancelled: 1 });
    expect(await dashboardOf(e3.id)).toEqual({ confirmed: 0, pending: 0, checkins: 0, available: 0, revenueCents: 0, refunded: 1 });

    // late gateway answer for t5 changes nothing (R11)
    await pool.query('UPDATE gateway_requests SET respond_at = now() WHERE ticket_id = $1', [t5.id]);
    while ((await processDueGatewayResponses()) > 0) {
      // drain
    }
    expect(await dashboardOf(e3.id)).toEqual({ confirmed: 0, pending: 0, checkins: 0, available: 0, revenueCents: 0, refunded: 1 });
  });

  it('revenue counts only confirmed tickets: declined and pending are left out; web and API count the same', async () => {
    const e = await newEvent({ capacity: 5, priceCents: 2000 });
    const api = await buy(e.id, 'api', CARD_OK);
    const web = await buy(e.id, 'web', CARD_OK);
    const declined = await buy(e.id, 'api', '4000000000000002');
    const pend = await buy(e.id, 'web', CARD_SLOW_OK);
    await holdPending(pend.id);
    expect(await settle(api.id)).toBe('confirmed');
    expect(await settle(web.id)).toBe('confirmed');
    expect(await settle(declined.id)).toBe('declined');
    expect(await dashboardOf(e.id)).toEqual({ confirmed: 2, pending: 1, checkins: 0, available: 2, revenueCents: 4000, refunded: 0 });
  });
});
