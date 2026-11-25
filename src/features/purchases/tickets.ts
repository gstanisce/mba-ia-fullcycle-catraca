import type { Db } from '../../db.js';

export type TicketStatus = 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'refunded';
export type TicketChannel = 'web' | 'api';

/** UI labels of ticket statuses (exact, from the brief). */
export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  pending: 'pendente',
  confirmed: 'confirmado',
  declined: 'recusado',
  cancelled: 'cancelado',
  refunded: 'estornado',
};

export interface TicketRow {
  id: string;
  eventId: string;
  code: string;
  status: TicketStatus;
  /** Price paid, snapshotted at purchase time (R03/R12). */
  priceCents: number;
  channel: TicketChannel;
  userId: string | null;
  buyerEmail: string;
  cardLast4: string;
  checkedInAt: Date | null;
  createdAt: Date;
}

/** A ticket with its event's name and start date ("Meus ingressos"). */
export interface UserTicketRow extends TicketRow {
  eventName: string;
  eventStartsAt: Date;
}

/** Columns selected by every ticket query, snake_case (map with `mapTicketRow`). */
export const TICKET_COLUMNS =
  'id, event_id, code, status, price_cents, channel, user_id, buyer_email, card_last4, checked_in_at, created_at';

/** Maps a snake_case `tickets` row to `TicketRow`. */
export function mapTicketRow(r: Record<string, unknown>): TicketRow {
  return {
    id: r.id as string,
    eventId: r.event_id as string,
    code: r.code as string,
    status: r.status as TicketStatus,
    priceCents: r.price_cents as number,
    channel: r.channel as TicketChannel,
    userId: (r.user_id as string | null) ?? null,
    buyerEmail: r.buyer_email as string,
    cardLast4: r.card_last4 as string,
    checkedInAt: (r.checked_in_at as Date | null) ?? null,
    createdAt: r.created_at as Date,
  };
}

export async function getTicketById(db: Db, id: string): Promise<TicketRow | null> {
  const { rows } = await db.query(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE id = $1`, [id]);
  return rows[0] ? mapTicketRow(rows[0]) : null;
}

export async function findTicketByCode(db: Db, code: string): Promise<TicketRow | null> {
  const { rows } = await db.query(`SELECT ${TICKET_COLUMNS} FROM tickets WHERE code = $1`, [code]);
  return rows[0] ? mapTicketRow(rows[0]) : null;
}

/** Tickets bought by a user (web), newest first, with event name and date. */
export async function listTicketsByUser(db: Db, userId: string): Promise<UserTicketRow[]> {
  const cols = TICKET_COLUMNS.split(', ')
    .map((c) => `t.${c}`)
    .join(', ');
  const { rows } = await db.query(
    `SELECT ${cols}, e.name AS event_name, e.starts_at AS event_starts_at
       FROM tickets t JOIN events e ON e.id = t.event_id
      WHERE t.user_id = $1
      ORDER BY t.created_at DESC, t.id DESC`,
    [userId],
  );
  return rows.map((r) => ({
    ...mapTicketRow(r),
    eventName: r.event_name as string,
    eventStartsAt: r.event_starts_at as Date,
  }));
}
