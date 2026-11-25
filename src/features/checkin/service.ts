// F05 check-in (R10). The five messages are exact (brief); the first true condition wins.
import { withTransaction } from '../../db.js';

export type CheckinResult = 'invalid' | 'event_cancelled' | 'not_confirmed' | 'already_used' | 'admitted';

/** Exact messages of R10, in precedence order. */
export const CHECKIN_MESSAGES: Readonly<Record<CheckinResult, string>> = {
  invalid: 'Ingresso inválido para este evento',
  event_cancelled: 'Evento cancelado',
  not_confirmed: 'Ingresso não confirmado',
  already_used: 'Ingresso já utilizado',
  admitted: 'Entrada liberada',
};

/** Normalizes a typed code: surrounding spaces removed, upper case. */
export function normalizeCheckinCode(rawCode: unknown): string {
  return typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
}

/**
 * Checks a ticket code in at an event whose ownership was already validated (`loadOwnedEvent`).
 * R10, first true condition wins: invalid (missing or other event) → event cancelled → not confirmed →
 * already used → admitted (sets `checked_in_at = now()`). The ticket row is locked (`FOR UPDATE`), so
 * simultaneous check-ins of the same code serialize and at most one is admitted.
 */
export async function checkIn(eventId: string, rawCode: unknown): Promise<{ result: CheckinResult; message: string }> {
  const code = normalizeCheckinCode(rawCode);
  const result = await withTransaction(async (client): Promise<CheckinResult> => {
    if (code === '') return 'invalid';
    const ev = await client.query<{ status: string }>('SELECT status FROM events WHERE id = $1', [eventId]);
    const { rows } = await client.query<{ id: string; status: string; checked_in_at: Date | null }>(
      'SELECT id, status, checked_in_at FROM tickets WHERE code = $1 AND event_id = $2 FOR UPDATE',
      [code, eventId],
    );
    const ticket = rows[0];
    if (!ev.rows[0] || !ticket) return 'invalid';
    if (ev.rows[0].status === 'cancelled') return 'event_cancelled';
    if (ticket.status !== 'confirmed') return 'not_confirmed';
    if (ticket.checked_in_at) return 'already_used';
    await client.query('UPDATE tickets SET checked_in_at = now() WHERE id = $1', [ticket.id]);
    return 'admitted';
  });
  return { result, message: CHECKIN_MESSAGES[result] };
}
