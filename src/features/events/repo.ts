import { pool, withTransaction, type Db } from '../../db.js';
import { newId } from '../../lib/ids.js';
import { occupiedSeats } from './seats.js';
import { MSG_STARTS_AT_PAST, type EventInput } from './validation.js';

export type EventStatus = 'draft' | 'published' | 'cancelled';

export const EVENT_STATUS_LABELS: Record<EventStatus, string> = {
  draft: 'Rascunho',
  published: 'Publicado',
  cancelled: 'Cancelado',
};

export interface EventRow {
  id: string;
  organizerId: string;
  name: string;
  venue: string;
  startsAt: Date;
  capacity: number;
  priceCents: number;
  status: EventStatus;
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  cancelledAt: Date | null;
}

/** Business-rule violation; routes render `message` with HTTP 422. */
export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

export const MSG_EVENT_NOT_FOUND = 'Evento não encontrado';
export const MSG_CANCELLED_NOT_EDITABLE = 'Evento cancelado não pode ser editado';
export const MSG_CANCELLED_NOT_PUBLISHABLE = 'Evento cancelado não pode ser publicado';
export const capacityBelowOccupiedMessage = (occupied: number): string =>
  `A lotação não pode ser menor que as vagas ocupadas (${occupied})`;

/** Columns selected by every query, in snake_case (map with `mapEventRow`). */
export const EVENT_COLUMNS =
  'id, organizer_id, name, venue, starts_at, capacity, price_cents, status, created_at, updated_at, published_at, cancelled_at';

/** Maps a snake_case `events` row (e.g. from `SELECT * FROM events`) to `EventRow`. */
export function mapEventRow(r: Record<string, unknown>): EventRow {
  return {
    id: r.id as string,
    organizerId: r.organizer_id as string,
    name: r.name as string,
    venue: r.venue as string,
    startsAt: r.starts_at as Date,
    capacity: r.capacity as number,
    priceCents: r.price_cents as number,
    status: r.status as EventStatus,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
    publishedAt: (r.published_at as Date | null) ?? null,
    cancelledAt: (r.cancelled_at as Date | null) ?? null,
  };
}

export async function getEventById(db: Db, id: string): Promise<EventRow | null> {
  const { rows } = await db.query(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = $1`, [id]);
  return rows[0] ? mapEventRow(rows[0]) : null;
}

export async function listEventsByOrganizer(db: Db, organizerId: string): Promise<EventRow[]> {
  const { rows } = await db.query(
    `SELECT ${EVENT_COLUMNS} FROM events WHERE organizer_id = $1 ORDER BY starts_at, created_at, id`,
    [organizerId],
  );
  return rows.map(mapEventRow);
}

/** Events on sale (R02): status `published` (so neither draft nor cancelled), ordered by start date. */
export async function listOnSaleEvents(db: Db = pool): Promise<EventRow[]> {
  const { rows } = await db.query(
    `SELECT ${EVENT_COLUMNS} FROM events WHERE status = 'published' ORDER BY starts_at, created_at, id`,
  );
  return rows.map(mapEventRow);
}

/** The event if it is on sale (published), else null. */
export async function getOnSaleEvent(db: Db, id: string): Promise<EventRow | null> {
  const { rows } = await db.query(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = $1 AND status = 'published'`, [id]);
  return rows[0] ? mapEventRow(rows[0]) : null;
}

/** Creates a draft event (R01/R02). `input` should come from `validateEventForm`. */
export async function createEvent(input: EventInput & { organizerId: string }): Promise<EventRow> {
  if (input.startsAt.getTime() <= Date.now()) throw new DomainError(MSG_STARTS_AT_PAST);
  const { rows } = await pool.query(
    `INSERT INTO events (id, organizer_id, name, venue, starts_at, capacity, price_cents)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${EVENT_COLUMNS}`,
    [newId('evt'), input.organizerId, input.name, input.venue, input.startsAt, input.capacity, input.priceCents],
  );
  return mapEventRow(rows[0]);
}

/** Locks the event row (`FOR UPDATE`) and checks ownership; DomainError if missing or not owned. */
async function lockOwnedEvent(db: Db, id: string, organizerId: string): Promise<EventRow> {
  const { rows } = await db.query(`SELECT ${EVENT_COLUMNS} FROM events WHERE id = $1 FOR UPDATE`, [id]);
  const event = rows[0] ? mapEventRow(rows[0]) : null;
  if (!event || event.organizerId !== organizerId) throw new DomainError(MSG_EVENT_NOT_FOUND);
  return event;
}

/**
 * Edits an event (R01, R03, R05). Holds the event row lock, so the occupied-seat count cannot change
 * between the check and the update (purchases and cancellation lock the same row).
 */
export async function updateEvent(id: string, organizerId: string, input: EventInput): Promise<EventRow> {
  return withTransaction(async (client) => {
    const event = await lockOwnedEvent(client, id, organizerId);
    if (event.status === 'cancelled') throw new DomainError(MSG_CANCELLED_NOT_EDITABLE);
    if (input.startsAt.getTime() <= Date.now()) throw new DomainError(MSG_STARTS_AT_PAST);
    const occupied = await occupiedSeats(client, id);
    if (input.capacity < occupied) throw new DomainError(capacityBelowOccupiedMessage(occupied));
    const { rows } = await client.query(
      `UPDATE events
          SET name = $2, venue = $3, starts_at = $4, capacity = $5, price_cents = $6, updated_at = now()
        WHERE id = $1
        RETURNING ${EVENT_COLUMNS}`,
      [id, input.name, input.venue, input.startsAt, input.capacity, input.priceCents],
    );
    return mapEventRow(rows[0]);
  });
}

/** draft → published (R02). Already published: no-op. Cancelled: DomainError. */
export async function publishEvent(id: string, organizerId: string): Promise<EventRow> {
  return withTransaction(async (client) => {
    const event = await lockOwnedEvent(client, id, organizerId);
    if (event.status === 'cancelled') throw new DomainError(MSG_CANCELLED_NOT_PUBLISHABLE);
    if (event.status !== 'draft') return event;
    const { rows } = await client.query(
      `UPDATE events SET status = 'published', published_at = now(), updated_at = now()
        WHERE id = $1
        RETURNING ${EVENT_COLUMNS}`,
      [id],
    );
    return mapEventRow(rows[0]);
  });
}
