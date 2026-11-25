import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import { checkIn, CHECKIN_MESSAGES, normalizeCheckinCode } from '../src/features/checkin/service.js';
import { processDueGatewayResponses } from '../src/features/purchases/gateway.js';
import { purchaseTicket } from '../src/features/purchases/service.js';
import { getTicketById, type TicketChannel, type TicketRow } from '../src/features/purchases/tickets.js';
import { resetDb, SEED } from './helpers.js';
import { newEvent, sleep, userIdByEmail, waitForStatus } from './purchases-helpers.js';

afterAll(async () => {
  await pool.end();
});

beforeEach(async () => {
  await resetDb();
});

const CARD_OK = '4000000000000001';
const CARD_SLOW_OK = '4000000000000003';
const CARD_DECLINED = '4000000000000002';

/** Buys a ticket through F03's single purchase path. No poller runs here, so it stays pending until delivered. */
async function buy(eventId: string, channel: TicketChannel = 'api', cardNumber = CARD_OK): Promise<TicketRow> {
  const userId = channel === 'web' ? await userIdByEmail(SEED.participant.email) : null;
  const res = await purchaseTicket({ eventId, buyerEmail: SEED.participant.email, cardNumber, userId, channel });
  if (!res.ok) throw new Error(res.error);
  return res.ticket;
}

/** Buys and waits for the gateway answer (delivered by `processDueGatewayResponses`). */
async function buyConfirmed(eventId: string, channel: TicketChannel = 'api'): Promise<TicketRow> {
  const t = await buy(eventId, channel, CARD_OK);
  const done = await waitForStatus(t.id, processDueGatewayResponses, 10_000);
  expect(done.status).toBe('confirmed');
  return done;
}

/** Keeps a ticket pending: pushes its gateway answer far into the future. */
const holdPending = (ticketId: string) =>
  pool.query("UPDATE gateway_requests SET respond_at = now() + interval '1 hour' WHERE ticket_id = $1", [ticketId]);

const cancelEvent = (id: string) => pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [id]);

describe('CHECKIN_MESSAGES (R10, exact text)', () => {
  it('has the five brief messages', () => {
    expect(CHECKIN_MESSAGES).toEqual({
      invalid: 'Ingresso inválido para este evento',
      event_cancelled: 'Evento cancelado',
      not_confirmed: 'Ingresso não confirmado',
      already_used: 'Ingresso já utilizado',
      admitted: 'Entrada liberada',
    });
  });
});

describe('checkIn — each R10 outcome (F05-AC1, F05-AC2, X09)', () => {
  it('confirmed web ticket → Entrada liberada, marks checked_in_at; again → Ingresso já utilizado', async () => {
    const event = await newEvent();
    const t = await buyConfirmed(event.id, 'web');
    expect(await checkIn(event.id, t.code)).toEqual({ result: 'admitted', message: 'Entrada liberada' });
    const after = await getTicketById(pool, t.id);
    expect(after!.checkedInAt).toBeInstanceOf(Date);
    expect(after!.status).toBe('confirmed');
    expect(await checkIn(event.id, t.code)).toEqual({ result: 'already_used', message: 'Ingresso já utilizado' });
    expect((await getTicketById(pool, t.id))!.checkedInAt!.getTime()).toBe(after!.checkedInAt!.getTime());
  });

  it('confirmed partner-API ticket → Entrada liberada', async () => {
    const event = await newEvent();
    const t = await buyConfirmed(event.id, 'api');
    expect((await checkIn(event.id, t.code)).message).toBe('Entrada liberada');
  });

  it('pending ticket (web and api) → Ingresso não confirmado, nothing marked', async () => {
    const event = await newEvent({ capacity: 5 });
    for (const channel of ['web', 'api'] as const) {
      const t = await buy(event.id, channel, CARD_SLOW_OK);
      await holdPending(t.id);
      expect(await checkIn(event.id, t.code)).toEqual({ result: 'not_confirmed', message: 'Ingresso não confirmado' });
      expect((await getTicketById(pool, t.id))!.checkedInAt).toBeNull();
    }
  });

  it('declined, cancelled and refunded tickets → Ingresso não confirmado', async () => {
    const event = await newEvent({ capacity: 5 });
    const declined = await buy(event.id, 'api', CARD_DECLINED);
    expect((await waitForStatus(declined.id, processDueGatewayResponses, 10_000)).status).toBe('declined');
    expect((await checkIn(event.id, declined.code)).message).toBe('Ingresso não confirmado');
    for (const status of ['cancelled', 'refunded']) {
      const t = await buyConfirmed(event.id);
      await pool.query('UPDATE tickets SET status = $2 WHERE id = $1', [t.id, status]);
      expect((await checkIn(event.id, t.code)).message).toBe('Ingresso não confirmado');
    }
  });

  it('unknown code, empty code and a code of another event → Ingresso inválido para este evento', async () => {
    const e1 = await newEvent({ name: 'E1' });
    const e2 = await newEvent({ name: 'E2' });
    const t2 = await buyConfirmed(e2.id);
    for (const code of ['ZZZZZZZZ', '', '   ', undefined, 42]) {
      expect(await checkIn(e1.id, code)).toEqual({ result: 'invalid', message: 'Ingresso inválido para este evento' });
    }
    expect((await checkIn(e1.id, t2.code)).message).toBe('Ingresso inválido para este evento');
    expect((await getTicketById(pool, t2.id))!.checkedInAt).toBeNull();
    // still valid at its own event
    expect((await checkIn(e2.id, t2.code)).message).toBe('Entrada liberada');
  });

  it('cancelled event, confirmed ticket → Evento cancelado (nothing marked)', async () => {
    const event = await newEvent();
    const t = await buyConfirmed(event.id);
    await cancelEvent(event.id);
    expect(await checkIn(event.id, t.code)).toEqual({ result: 'event_cancelled', message: 'Evento cancelado' });
    expect((await getTicketById(pool, t.id))!.checkedInAt).toBeNull();
  });
});

describe('checkIn — precedence: the first true condition wins (R10)', () => {
  it('code of another event / unknown code at a cancelled event → inválido (1 before 2)', async () => {
    const e1 = await newEvent({ name: 'E1' });
    const e2 = await newEvent({ name: 'E2' });
    const t2 = await buyConfirmed(e2.id);
    await cancelEvent(e1.id);
    expect((await checkIn(e1.id, t2.code)).message).toBe('Ingresso inválido para este evento');
    expect((await checkIn(e1.id, 'ZZZZZZZZ')).message).toBe('Ingresso inválido para este evento');
  });

  it('pending ticket at a cancelled event → Evento cancelado (2 before 3)', async () => {
    const event = await newEvent();
    const t = await buy(event.id, 'web', CARD_SLOW_OK);
    await holdPending(t.id);
    await cancelEvent(event.id);
    expect((await checkIn(event.id, t.code)).message).toBe('Evento cancelado');
  });

  it('already used ticket at a cancelled event → Evento cancelado (2 before 4)', async () => {
    const event = await newEvent();
    const t = await buyConfirmed(event.id);
    expect((await checkIn(event.id, t.code)).message).toBe('Entrada liberada');
    await cancelEvent(event.id);
    expect((await checkIn(event.id, t.code)).message).toBe('Evento cancelado');
  });

  it('used ticket that is no longer confirmed → Ingresso não confirmado (3 before 4)', async () => {
    const event = await newEvent();
    const t = await buyConfirmed(event.id);
    expect((await checkIn(event.id, t.code)).message).toBe('Entrada liberada');
    await pool.query("UPDATE tickets SET status = 'refunded' WHERE id = $1", [t.id]);
    expect((await checkIn(event.id, t.code)).message).toBe('Ingresso não confirmado');
  });
});

describe('checkIn — code normalization', () => {
  it('normalizeCheckinCode trims and upper-cases', () => {
    expect(normalizeCheckinCode('  ab12cd34 \t')).toBe('AB12CD34');
    expect(normalizeCheckinCode(undefined)).toBe('');
  });

  it('lower case with spaces → Entrada liberada', async () => {
    const event = await newEvent();
    const t = await buyConfirmed(event.id);
    expect((await checkIn(event.id, `   ${t.code.toLowerCase()}  `)).message).toBe('Entrada liberada');
    expect((await checkIn(event.id, ` ${t.code} `)).message).toBe('Ingresso já utilizado');
  });
});

describe('checkIn — concurrency (F05-AC2)', () => {
  it('10 simultaneous check-ins of the same code → exactly 1 admitted, 9 already used', async () => {
    const event = await newEvent();
    const t = await buyConfirmed(event.id);
    const results = await Promise.all(Array.from({ length: 10 }, () => checkIn(event.id, t.code)));
    expect(results.filter((r) => r.result === 'admitted')).toHaveLength(1);
    expect(results.filter((r) => r.result === 'already_used')).toHaveLength(9);
    expect((await getTicketById(pool, t.id))!.checkedInAt).not.toBeNull();
  });

  it('a check-in racing with a cancellation (event locked FOR UPDATE) sees the cancel → Evento cancelado', async () => {
    const event = await newEvent();
    const t = await buyConfirmed(event.id);
    // Simulates F06: lock the event, cancel it, refund its tickets, in one transaction.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM events WHERE id = $1 FOR UPDATE', [event.id]);
      const pending = checkIn(event.id, t.code); // waits for the event lock
      await sleep(100);
      await client.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [event.id]);
      await client.query("UPDATE tickets SET status = 'refunded' WHERE event_id = $1 AND status = 'confirmed'", [event.id]);
      await client.query('COMMIT');
      expect((await pending).message).toBe('Evento cancelado');
    } finally {
      client.release();
    }
    expect((await getTicketById(pool, t.id))!.checkedInAt).toBeNull();
  });
});
