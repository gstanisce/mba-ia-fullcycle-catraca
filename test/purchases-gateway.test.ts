import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';
import {
  applyGatewayResult,
  decideSimulated,
  processDueGatewayResponses,
} from '../src/features/purchases/gateway.js';
import { purchaseTicket } from '../src/features/purchases/service.js';
import { getTicketById, type TicketStatus } from '../src/features/purchases/tickets.js';
import { resetDb } from './helpers.js';
import { newEvent, sleep, waitForStatus } from './purchases-helpers.js';

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetDb();
});

const card = (last4: string) => `400000000000${last4}`;
const MIN = () => 0;
const MAX = () => 1;
const MID = () => 0.5;

describe('decideSimulated by card ending (R08, F03-AC2)', () => {
  const s = config.gatewayDelayScale;
  const cases: Array<[string, boolean, number, number]> = [
    ['0001', true, 2000, 5000],
    ['0002', false, 2000, 5000],
    ['0003', true, 30000, 40000],
    ['0004', false, 30000, 40000],
    ['0005', false, 2000, 5000],
    ['9999', false, 2000, 5000],
  ];
  it.each(cases)('ending %s → approved=%s, delay %d–%d ms × scale', (last4, approved, min, max) => {
    expect(decideSimulated(card(last4), MIN)).toEqual({ approved, delayMs: min * s });
    expect(decideSimulated(card(last4), MAX)).toEqual({ approved, delayMs: max * s });
    expect(decideSimulated(card(last4), MID)).toEqual({ approved, delayMs: ((min + max) / 2) * s });
  });

  it('default random delay stays within the range', () => {
    for (let i = 0; i < 200; i++) {
      const d = decideSimulated(card('0003'));
      expect(d.delayMs).toBeGreaterThanOrEqual(30000 * s);
      expect(d.delayMs).toBeLessThanOrEqual(40000 * s);
    }
  });

  it('gates run with the scaled delays (GATEWAY_DELAY_SCALE=0.01)', () => {
    expect(s).toBe(0.01);
  });
});

async function buyPending(last4: string, capacity = 5) {
  const event = await newEvent({ capacity });
  const res = await purchaseTicket({
    eventId: event.id,
    buyerEmail: 'buyer@x.com',
    cardNumber: card(last4),
    userId: null,
    channel: 'api',
  });
  if (!res.ok) throw new Error(res.error);
  return { event, ticket: res.ticket };
}

describe('gateway request stored with its future answer', () => {
  it.each([
    ['0001', true, 2000, 5000],
    ['0002', false, 2000, 5000],
    ['0003', true, 30000, 40000],
    ['0004', false, 30000, 40000],
    ['1234', false, 2000, 5000],
  ] as const)('%s: approved=%s, respond_at − purchase within the scaled range', async (last4, approved, min, max) => {
    const { ticket } = await buyPending(last4);
    const { rows } = await pool.query(
      `SELECT g.approved, extract(epoch FROM (g.respond_at - t.created_at)) * 1000 AS ms, g.delivered_at
         FROM gateway_requests g JOIN tickets t ON t.id = g.ticket_id WHERE g.ticket_id = $1`,
      [ticket.id],
    );
    expect(rows[0].approved).toBe(approved);
    expect(rows[0].delivered_at).toBeNull();
    const ms = Number(rows[0].ms);
    expect(ms).toBeGreaterThanOrEqual(min * config.gatewayDelayScale - 1);
    expect(ms).toBeLessThanOrEqual(max * config.gatewayDelayScale + 1);
  });
});

describe('processDueGatewayResponses (async delivery, R06/R08)', () => {
  it('0001 → confirmed, 0002 → declined, other ending → declined; each delivered once', async () => {
    const a = await buyPending('0001');
    const b = await buyPending('0002');
    const c = await buyPending('7777');
    expect(a.ticket.status).toBe('pending');
    expect((await waitForStatus(a.ticket.id, processDueGatewayResponses)).status).toBe('confirmed');
    expect((await waitForStatus(b.ticket.id, processDueGatewayResponses)).status).toBe('declined');
    expect((await waitForStatus(c.ticket.id, processDueGatewayResponses)).status).toBe('declined');
    const { rows } = await pool.query('SELECT count(*) AS n FROM gateway_requests WHERE delivered_at IS NULL');
    expect(rows[0].n).toBe(0);
    expect(await processDueGatewayResponses()).toBe(0);
  });

  it('answers are not delivered before respond_at (0003 stays pending, then confirmed; 0004 declined)', async () => {
    const c = await buyPending('0003');
    const d = await buyPending('0004');
    await sleep(100); // < 300 ms (30 s × 0.01)
    await processDueGatewayResponses();
    expect((await getTicketById(pool, c.ticket.id))!.status).toBe('pending');
    expect((await getTicketById(pool, d.ticket.id))!.status).toBe('pending');
    await sleep(350); // > 400 ms after purchase
    await processDueGatewayResponses();
    expect((await getTicketById(pool, c.ticket.id))!.status).toBe('confirmed');
    expect((await getTicketById(pool, d.ticket.id))!.status).toBe('declined');
  });
});

describe('applyGatewayResult only changes pending tickets (R08/R11, F03-AC9, C03-11)', () => {
  it('pending → confirmed / declined', async () => {
    const a = await buyPending('0001');
    expect(await applyGatewayResult(pool, a.ticket.id, true)).toBe(true);
    expect((await getTicketById(pool, a.ticket.id))!.status).toBe('confirmed');
    const b = await buyPending('0001');
    expect(await applyGatewayResult(pool, b.ticket.id, false)).toBe(true);
    expect((await getTicketById(pool, b.ticket.id))!.status).toBe('declined');
  });

  const others: TicketStatus[] = ['confirmed', 'declined', 'cancelled', 'refunded'];
  it.each(others)('%s ticket is not changed by an approval or a refusal', async (status) => {
    const { ticket } = await buyPending('0003');
    await pool.query('UPDATE tickets SET status = $2 WHERE id = $1', [ticket.id, status]);
    expect(await applyGatewayResult(pool, ticket.id, true)).toBe(false);
    expect(await applyGatewayResult(pool, ticket.id, false)).toBe(false);
    expect((await getTicketById(pool, ticket.id))!.status).toBe(status);
  });

  it('a late gateway answer delivered by the poller keeps cancelled/refunded', async () => {
    const x = await buyPending('0003');
    const y = await buyPending('0004');
    await pool.query("UPDATE tickets SET status = 'refunded' WHERE id = $1", [x.ticket.id]);
    await pool.query("UPDATE tickets SET status = 'cancelled' WHERE id = $1", [y.ticket.id]);
    await pool.query("UPDATE gateway_requests SET respond_at = now() - interval '1 second'");
    expect(await processDueGatewayResponses()).toBe(2);
    expect((await getTicketById(pool, x.ticket.id))!.status).toBe('refunded');
    expect((await getTicketById(pool, y.ticket.id))!.status).toBe('cancelled');
  });
});
