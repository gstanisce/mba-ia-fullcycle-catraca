import { pool } from '../src/db.js';
import { createEvent, publishEvent, type EventRow } from '../src/features/events/repo.js';
import type { EventInput } from '../src/features/events/validation.js';
import { getTicketById, type TicketRow } from '../src/features/purchases/tickets.js';
import { SEED } from './helpers.js';

const DAY = 24 * 60 * 60 * 1000;

export async function userIdByEmail(email: string): Promise<string> {
  const { rows } = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  if (!rows[0]) throw new Error(`no user ${email}`);
  return rows[0].id;
}

/** Creates an event of organizer A (published unless `draft`). */
export async function newEvent(patch: Partial<EventInput> = {}, opts: { draft?: boolean } = {}): Promise<EventRow> {
  const organizerId = await userIdByEmail(SEED.organizerA.email);
  const event = await createEvent({
    name: 'E1',
    venue: 'Bar',
    startsAt: new Date(Date.now() + 30 * DAY),
    capacity: 2,
    priceCents: 10000,
    ...patch,
    organizerId,
  });
  return opts.draft ? event : publishEvent(event.id, organizerId);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polls the ticket until it leaves `pending` (or `timeoutMs`), calling `tick` each round (e.g. a poller cycle). */
export async function waitForStatus(
  ticketId: string,
  tick: () => Promise<unknown> = async () => {},
  timeoutMs = 2000,
): Promise<TicketRow> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await tick();
    const t = await getTicketById(pool, ticketId);
    if (!t) throw new Error(`ticket ${ticketId} not found`);
    if (t.status !== 'pending' || Date.now() > deadline) return t;
    await sleep(20);
  }
}

export async function countTickets(eventId?: string): Promise<number> {
  const { rows } = eventId
    ? await pool.query('SELECT count(*) AS n FROM tickets WHERE event_id = $1', [eventId])
    : await pool.query('SELECT count(*) AS n FROM tickets');
  return rows[0].n;
}
