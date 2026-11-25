// F07 — event dashboard (R12). Web and partner-API sales count the same; seats come from F02 (R05).
import type { Db } from '../../db.js';
import type { EventRow } from '../events/repo.js';
import { availableSeats } from '../events/seats.js';

export interface Dashboard {
  /** Tickets `confirmed` (including the checked-in ones). */
  confirmed: number;
  /** Tickets `pending`. */
  pending: number;
  /** Confirmed tickets with `checked_in_at` set. */
  checkins: number;
  /** `availableSeats` of F02 (0 if the event is cancelled). */
  available: number;
  /** Sum of `tickets.price_cents` (price recorded at purchase) of confirmed tickets only. */
  revenueCents: number;
  /** Tickets `refunded`. */
  refunded: number;
}

/** Aggregates the dashboard numbers of an event (one query + `availableSeats`). */
export async function getDashboard(db: Db, event: EventRow): Promise<Dashboard> {
  const { rows } = await db.query<{
    confirmed: number;
    pending: number;
    checkins: number;
    revenue_cents: number;
    refunded: number;
  }>(
    `SELECT count(*) FILTER (WHERE status = 'confirmed') AS confirmed,
            count(*) FILTER (WHERE status = 'pending') AS pending,
            count(*) FILTER (WHERE status = 'confirmed' AND checked_in_at IS NOT NULL) AS checkins,
            coalesce(sum(price_cents) FILTER (WHERE status = 'confirmed'), 0)::bigint AS revenue_cents,
            count(*) FILTER (WHERE status = 'refunded') AS refunded
       FROM tickets
      WHERE event_id = $1`,
    [event.id],
  );
  const r = rows[0]!;
  return {
    confirmed: Number(r.confirmed),
    pending: Number(r.pending),
    checkins: Number(r.checkins),
    available: await availableSeats(db, event),
    revenueCents: Number(r.revenue_cents),
    refunded: Number(r.refunded),
  };
}
