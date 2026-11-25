import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pool } from '../src/db.js';
import {
  capacityBelowOccupiedMessage,
  createEvent,
  DomainError,
  getEventById,
  getOnSaleEvent,
  listEventsByOrganizer,
  listOnSaleEvents,
  MSG_CANCELLED_NOT_EDITABLE,
  MSG_CANCELLED_NOT_PUBLISHABLE,
  MSG_EVENT_NOT_FOUND,
  publishEvent,
  updateEvent,
  type EventRow,
} from '../src/features/events/repo.js';
import { availableSeats, computeAvailable, occupiedSeats } from '../src/features/events/seats.js';
import { MSG_STARTS_AT_PAST, type EventInput } from '../src/features/events/validation.js';
import { newId, newTicketCode } from '../src/lib/ids.js';
import { resetDb, SEED } from './helpers.js';

afterAll(async () => {
  await pool.end();
});

let orgA: string;
let orgB: string;

beforeEach(async () => {
  await resetDb();
  const { rows } = await pool.query('SELECT id, email FROM users');
  orgA = rows.find((r) => r.email === SEED.organizerA.email).id;
  orgB = rows.find((r) => r.email === SEED.organizerB.email).id;
});

const DAY = 24 * 60 * 60 * 1000;
const input = (patch: Partial<EventInput> = {}): EventInput => ({
  name: 'E1',
  venue: 'Bar',
  startsAt: new Date(Date.now() + 30 * DAY),
  capacity: 2,
  priceCents: 10000,
  ...patch,
});

async function newEvent(patch: Partial<EventInput> = {}, organizerId = orgA): Promise<EventRow> {
  return createEvent({ ...input(patch), organizerId });
}

async function insertTicket(eventId: string, status: string): Promise<void> {
  await pool.query(
    `INSERT INTO tickets (id, event_id, code, status, price_cents, channel, buyer_email, card_last4)
     VALUES ($1, $2, $3, $4, 10000, 'api', 'a@x.com', '0001')`,
    [newId('tkt'), eventId, newTicketCode(), status],
  );
}

async function expectDomainError(p: Promise<unknown>, message: string): Promise<void> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DomainError);
  expect((err as Error).message).toBe(message);
}

describe('seats (R05, F02-AC7)', () => {
  it('computeAvailable: capacity - occupied, never negative, 0 when cancelled', () => {
    expect(computeAvailable({ capacity: 5, status: 'published' }, 0)).toBe(5);
    expect(computeAvailable({ capacity: 5, status: 'published' }, 2)).toBe(3);
    expect(computeAvailable({ capacity: 5, status: 'draft' }, 5)).toBe(0);
    expect(computeAvailable({ capacity: 2, status: 'published' }, 3)).toBe(0);
    expect(computeAvailable({ capacity: 5, status: 'cancelled' }, 0)).toBe(0);
  });

  it('pending and confirmed hold seats; declined, cancelled and refunded do not', async () => {
    const event = await newEvent({ capacity: 10 });
    expect(await occupiedSeats(pool, event.id)).toBe(0);
    expect(await availableSeats(pool, event)).toBe(10);

    await insertTicket(event.id, 'pending');
    await insertTicket(event.id, 'confirmed');
    expect(await occupiedSeats(pool, event.id)).toBe(2);
    expect(await availableSeats(pool, event)).toBe(8);

    for (const status of ['declined', 'cancelled', 'refunded']) await insertTicket(event.id, status);
    expect(await occupiedSeats(pool, event.id)).toBe(2);
    expect(await availableSeats(pool, event)).toBe(8);

    // checked-in confirmed tickets still hold their seat
    await pool.query("UPDATE tickets SET checked_in_at = now() WHERE event_id = $1 AND status = 'confirmed'", [event.id]);
    expect(await availableSeats(pool, event)).toBe(8);
  });

  it('counts only tickets of the given event', async () => {
    const e1 = await newEvent({ capacity: 3 });
    const e2 = await newEvent({ capacity: 3 });
    await insertTicket(e2.id, 'confirmed');
    expect(await availableSeats(pool, e1)).toBe(3);
    expect(await availableSeats(pool, e2)).toBe(2);
  });

  it('cancelled event has 0 available seats', async () => {
    const event = await newEvent({ capacity: 10 });
    await insertTicket(event.id, 'confirmed');
    await pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [event.id]);
    expect(await availableSeats(pool, (await getEventById(pool, event.id))!)).toBe(0);
  });
});

describe('repo: create / list / on sale (R01, R02)', () => {
  it('createEvent creates a draft with an evt_ id', async () => {
    const event = await newEvent();
    expect(event.id).toMatch(/^evt_[0-9a-z]{10}$/);
    expect(event).toMatchObject({ organizerId: orgA, name: 'E1', venue: 'Bar', capacity: 2, priceCents: 10000, status: 'draft' });
    expect(event.publishedAt).toBeNull();
    expect(await getEventById(pool, event.id)).toEqual(event);
  });

  it('createEvent rejects a past date', async () => {
    await expectDomainError(newEvent({ startsAt: new Date(Date.now() - DAY) }), MSG_STARTS_AT_PAST);
  });

  it('draft is not on sale; published is; listOnSaleEvents is ordered by start date', async () => {
    const later = await newEvent({ name: 'Later', startsAt: new Date(Date.now() + 20 * DAY) });
    const sooner = await newEvent({ name: 'Sooner', startsAt: new Date(Date.now() + 10 * DAY) });
    const draft = await newEvent({ name: 'Draft' });
    expect(await listOnSaleEvents(pool)).toEqual([]);
    expect(await getOnSaleEvent(pool, later.id)).toBeNull();

    await publishEvent(later.id, orgA);
    await publishEvent(sooner.id, orgA);
    expect((await listOnSaleEvents()).map((e) => e.name)).toEqual(['Sooner', 'Later']);
    expect((await getOnSaleEvent(pool, later.id))?.status).toBe('published');
    expect(await getOnSaleEvent(pool, draft.id)).toBeNull();

    await pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [later.id]);
    expect((await listOnSaleEvents(pool)).map((e) => e.name)).toEqual(['Sooner']);
    expect(await getOnSaleEvent(pool, later.id)).toBeNull();
  });

  it('listEventsByOrganizer returns only that organizer events', async () => {
    await newEvent({ name: 'A1' });
    await newEvent({ name: 'B1' }, orgB);
    expect((await listEventsByOrganizer(pool, orgA)).map((e) => e.name)).toEqual(['A1']);
    expect((await listEventsByOrganizer(pool, orgB)).map((e) => e.name)).toEqual(['B1']);
  });
});

describe('repo: publish', () => {
  it('draft → published sets published_at; publishing again is a no-op', async () => {
    const event = await newEvent();
    const pub = await publishEvent(event.id, orgA);
    expect(pub.status).toBe('published');
    expect(pub.publishedAt).toBeInstanceOf(Date);
    const again = await publishEvent(event.id, orgA);
    expect(again.publishedAt).toEqual(pub.publishedAt);
  });

  it('rejects cancelled events and non-owners', async () => {
    const event = await newEvent();
    await expectDomainError(publishEvent(event.id, orgB), MSG_EVENT_NOT_FOUND);
    await expectDomainError(publishEvent('evt_missing000', orgA), MSG_EVENT_NOT_FOUND);
    await pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [event.id]);
    await expectDomainError(publishEvent(event.id, orgA), MSG_CANCELLED_NOT_PUBLISHABLE);
    expect((await getEventById(pool, event.id))?.status).toBe('cancelled');
  });
});

describe('repo: update (R01, R03, R05, F02-AC4)', () => {
  it('updates every field', async () => {
    const event = await newEvent();
    const startsAt = new Date(Date.now() + 40 * DAY);
    const updated = await updateEvent(event.id, orgA, { name: 'E1b', venue: 'Teatro', startsAt, capacity: 7, priceCents: 15000 });
    expect(updated).toMatchObject({ name: 'E1b', venue: 'Teatro', startsAt, capacity: 7, priceCents: 15000, status: 'draft' });
  });

  it('capacity below occupied (pending + confirmed) is rejected; equal and above are accepted', async () => {
    const event = await newEvent({ capacity: 2 });
    await publishEvent(event.id, orgA);
    await insertTicket(event.id, 'pending');
    await insertTicket(event.id, 'confirmed');
    await insertTicket(event.id, 'declined');
    await insertTicket(event.id, 'refunded');

    await expectDomainError(updateEvent(event.id, orgA, input({ capacity: 1 })), capacityBelowOccupiedMessage(2));
    expect((await getEventById(pool, event.id))?.capacity).toBe(2);
    expect(capacityBelowOccupiedMessage(2)).toBe('A lotação não pode ser menor que as vagas ocupadas (2)');

    expect((await updateEvent(event.id, orgA, input({ capacity: 2 }))).capacity).toBe(2);
    const bigger = await updateEvent(event.id, orgA, input({ capacity: 3 }));
    expect(bigger.capacity).toBe(3);
    expect(await availableSeats(pool, bigger)).toBe(1);
  });

  it('rejects a past date and leaves the event unchanged', async () => {
    const event = await newEvent();
    await expectDomainError(
      updateEvent(event.id, orgA, input({ name: 'X', startsAt: new Date(Date.now() - DAY) })),
      MSG_STARTS_AT_PAST,
    );
    expect(await getEventById(pool, event.id)).toEqual(event);
  });

  it('rejects cancelled events and non-owners', async () => {
    const event = await newEvent();
    await expectDomainError(updateEvent(event.id, orgB, input({ name: 'Hacked' })), MSG_EVENT_NOT_FOUND);
    await pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [event.id]);
    await expectDomainError(updateEvent(event.id, orgA, input({ name: 'X' })), MSG_CANCELLED_NOT_EDITABLE);
    expect((await getEventById(pool, event.id))?.name).toBe('E1');
  });

  it('waits for the event row lock (FOR UPDATE) and sees seats taken meanwhile', async () => {
    const event = await newEvent({ capacity: 2 });
    const client = await pool.connect();
    try {
      // Simulates a purchase in flight: it holds the event row lock and inserts a ticket.
      await client.query('BEGIN');
      await client.query('SELECT id FROM events WHERE id = $1 FOR UPDATE', [event.id]);
      let settled = false;
      const pending = updateEvent(event.id, orgA, input({ capacity: 1 })).finally(() => {
        settled = true;
      });
      pending.catch(() => {}); // asserted below
      await new Promise((r) => setTimeout(r, 200));
      expect(settled).toBe(false); // blocked on the lock
      for (const status of ['pending', 'confirmed']) {
        await client.query(
          `INSERT INTO tickets (id, event_id, code, status, price_cents, channel, buyer_email, card_last4)
           VALUES ($1, $2, $3, $4, 10000, 'web', 'a@x.com', '0001')`,
          [newId('tkt'), event.id, newTicketCode(), status],
        );
      }
      await client.query('COMMIT');
      await expectDomainError(pending, capacityBelowOccupiedMessage(2));
    } finally {
      client.release();
    }
  });
});
