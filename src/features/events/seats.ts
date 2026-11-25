// Single source of truth for R05 (seats). Never count tickets for availability anywhere else: import from here.
import type { Db } from '../../db.js';
import type { EventRow } from './repo.js';

/** Ticket statuses that hold a seat: pending (awaiting the gateway) and confirmed. */
export const SEAT_HOLDING_STATUSES = ['pending', 'confirmed'] as const;

/**
 * Occupied seats = tickets `pending` + `confirmed` of the event.
 * Inside a purchase/edit transaction, call it AFTER locking the event row (`FOR UPDATE`).
 */
export async function occupiedSeats(db: Db, eventId: string): Promise<number> {
  const { rows } = await db.query<{ n: number }>(
    `SELECT count(*) AS n FROM tickets WHERE event_id = $1 AND status IN ('pending', 'confirmed')`,
    [eventId],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Available seats: 0 if the event is cancelled; otherwise max(0, capacity - occupied). */
export function computeAvailable(event: { capacity: number; status: string }, occupied: number): number {
  if (event.status === 'cancelled') return 0;
  return Math.max(0, event.capacity - occupied);
}

/** Available seats of an event (R05). */
export async function availableSeats(db: Db, event: EventRow): Promise<number> {
  if (event.status === 'cancelled') return 0;
  return computeAvailable(event, await occupiedSeats(db, event.id));
}
