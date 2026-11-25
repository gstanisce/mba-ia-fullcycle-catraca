// Simulated payment gateway (R08). The ONLY place where a gateway answer changes a ticket's status is
// `applyGatewayResult`, and it only touches `pending` tickets (R11: late answers never change other statuses).
import type { FastifyInstance } from 'fastify';
import { config } from '../../config.js';
import { withTransaction, type Db } from '../../db.js';

export interface GatewayDecision {
  approved: boolean;
  /** Milliseconds until the gateway answers, already multiplied by `config.gatewayDelayScale`. */
  delayMs: number;
}

interface SimulatedRule {
  approved: boolean;
  minMs: number;
  maxMs: number;
}

/** Card number ending → simulated answer (brief). Any other ending: declined in 2–5 s. */
export const SIMULATED_RULES: Readonly<Record<string, SimulatedRule>> = {
  '0001': { approved: true, minMs: 2000, maxMs: 5000 },
  '0002': { approved: false, minMs: 2000, maxMs: 5000 },
  '0003': { approved: true, minMs: 30000, maxMs: 40000 },
  '0004': { approved: false, minMs: 30000, maxMs: 40000 },
};
export const DEFAULT_SIMULATED_RULE: SimulatedRule = { approved: false, minMs: 2000, maxMs: 5000 };

/** Decides the simulated answer for a card: approval by ending, delay uniform in the range × delay scale. */
export function decideSimulated(cardNumber: string, rng: () => number = Math.random): GatewayDecision {
  const rule = SIMULATED_RULES[cardNumber.slice(-4)] ?? DEFAULT_SIMULATED_RULE;
  const base = rule.minMs + rng() * (rule.maxMs - rule.minMs);
  return { approved: rule.approved, delayMs: base * config.gatewayDelayScale };
}

/**
 * Sends the authorization request to the (simulated) gateway. Runs inside the purchase transaction:
 * the request is stored with its future answer and is delivered later by the poller (R06: never awaited).
 */
export async function requestAuthorization(db: Db, ticket: { id: string }, cardNumber: string): Promise<GatewayDecision> {
  const decision = decideSimulated(cardNumber);
  await db.query(
    `INSERT INTO gateway_requests (ticket_id, approved, respond_at)
     VALUES ($1, $2, now() + ($3::double precision * interval '1 millisecond'))`,
    [ticket.id, decision.approved, decision.delayMs],
  );
  return decision;
}

/**
 * Applies a gateway answer: `pending → confirmed` (approved) or `pending → declined`.
 * Tickets in any other status are left untouched (R08/R11). Returns true when the ticket changed.
 */
export async function applyGatewayResult(db: Db, ticketId: string, approved: boolean): Promise<boolean> {
  const res = await db.query(
    `UPDATE tickets SET status = CASE WHEN $2::boolean THEN 'confirmed' ELSE 'declined' END
      WHERE id = $1 AND status = 'pending'`,
    [ticketId, approved],
  );
  return (res.rowCount ?? 0) > 0;
}

/** One poller cycle: delivers every due gateway answer (up to 50). Returns how many were delivered. */
export async function processDueGatewayResponses(): Promise<number> {
  return withTransaction(async (client) => {
    const { rows } = await client.query<{ ticket_id: string; approved: boolean }>(
      `SELECT ticket_id, approved FROM gateway_requests
        WHERE delivered_at IS NULL AND respond_at <= now()
        ORDER BY respond_at
        LIMIT 50
        FOR UPDATE SKIP LOCKED`,
    );
    for (const row of rows) {
      await applyGatewayResult(client, row.ticket_id, row.approved);
      await client.query('UPDATE gateway_requests SET delivered_at = now() WHERE ticket_id = $1', [row.ticket_id]);
    }
    return rows.length;
  });
}

export const GATEWAY_POLL_INTERVAL_MS = 200;

/**
 * Starts the answer-delivery poller with the app (`onReady`) and stops it on `app.close()` (`onClose`,
 * waiting for a running cycle), so neither the app nor the tests hang.
 */
export function startGatewayPoller(app: FastifyInstance): void {
  let timer: NodeJS.Timeout | null = null;
  let current: Promise<void> | null = null;

  const tick = () => {
    if (current) return; // no re-entrancy
    current = processDueGatewayResponses()
      .then(() => undefined)
      .catch((err: unknown) => {
        app.log.error({ err }, 'gateway poller cycle failed');
      })
      .finally(() => {
        current = null;
      });
  };

  app.addHook('onReady', async () => {
    timer = setInterval(tick, GATEWAY_POLL_INTERVAL_MS);
  });

  app.addHook('onClose', async () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (current) await current;
  });
}
