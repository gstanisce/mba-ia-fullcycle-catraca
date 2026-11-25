// F06 — event cancellation (R11). The event row lock is the same one purchases (F03) and edits (F02) take,
// so no purchase can slip in between the status change and the ticket updates.
import { withTransaction } from '../../db.js';
import { EVENT_COLUMNS, mapEventRow, MSG_EVENT_NOT_FOUND } from '../events/repo.js';

export const MSG_ONLY_PUBLISHED_CANCELLABLE = 'Somente eventos publicados podem ser cancelados';
export const MSG_ALREADY_CANCELLED = 'Evento já cancelado';
export const MSG_CANCELLED = 'Evento cancelado';

export type CancelResult = { ok: true; refunded: number; cancelled: number } | { ok: false; message: string };

/**
 * Cancels a published event of `organizerId` in one transaction: event → `cancelled` (terminal),
 * tickets `confirmed → refunded` and `pending → cancelled`. Synchronous, so R11's "within 10 s" holds at once.
 * Late gateway answers cannot undo it: `applyGatewayResult` (F03) only changes `pending` tickets.
 */
export async function cancelEvent(eventId: string, organizerId: string): Promise<CancelResult> {
  return withTransaction(async (client): Promise<CancelResult> => {
    const { rows } = await client.query(
      `SELECT ${EVENT_COLUMNS} FROM events WHERE id = $1 AND organizer_id = $2 FOR UPDATE`,
      [eventId, organizerId],
    );
    const event = rows[0] ? mapEventRow(rows[0]) : null;
    if (!event) return { ok: false, message: MSG_EVENT_NOT_FOUND };
    if (event.status === 'cancelled') return { ok: false, message: MSG_ALREADY_CANCELLED };
    if (event.status !== 'published') return { ok: false, message: MSG_ONLY_PUBLISHED_CANCELLABLE };

    await client.query(`UPDATE events SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = $1`, [
      eventId,
    ]);
    const refunded = await client.query(`UPDATE tickets SET status = 'refunded' WHERE event_id = $1 AND status = 'confirmed'`, [
      eventId,
    ]);
    const cancelled = await client.query(`UPDATE tickets SET status = 'cancelled' WHERE event_id = $1 AND status = 'pending'`, [
      eventId,
    ]);
    return { ok: true, refunded: refunded.rowCount ?? 0, cancelled: cancelled.rowCount ?? 0 };
  });
}
