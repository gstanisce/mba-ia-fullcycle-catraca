// F04-AC5 / R07 / C04-13: real HTTP concurrency (a listening server and fetch, not inject).
import type { FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';
import { resetDb } from './helpers.js';
import { newEvent } from './purchases-helpers.js';

let app: FastifyInstance;
let base: string;

beforeAll(async () => {
  app = await buildApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await resetDb();
});

const REQUESTS = 30;
const CAPACITY = 5;

/** Fires REQUESTS purchases at once; returns [status, body] of each. */
function burst(eventId: string): Promise<Array<[number, Record<string, unknown>]>> {
  return Promise.all(
    Array.from({ length: REQUESTS }, async (_, i) => {
      const res = await fetch(`${base}/api/partner/events/${eventId}/purchases`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': config.partnerApiKey },
        body: JSON.stringify({ buyerEmail: `carga${i}@example.com`, cardNumber: '4000000000000001' }),
      });
      return [res.status, (await res.json()) as Record<string, unknown>] as [number, Record<string, unknown>];
    }),
  );
}

describe('30 simultaneous HTTP purchases on a capacity-5 event (R07, F04-AC5)', () => {
  for (const round of [1, 2, 3]) {
    it(`round ${round}, fresh event: exactly 5×202 and 25×409`, async () => {
      const ev = await newEvent({ name: `Carga ${round}`, capacity: CAPACITY });
      const results = await burst(ev.id);

      const accepted = results.filter(([s]) => s === 202);
      const soldOut = results.filter(([s]) => s === 409);
      expect(accepted).toHaveLength(CAPACITY);
      expect(soldOut).toHaveLength(REQUESTS - CAPACITY);
      for (const [, body] of accepted) expect(body.status).toBe('pending');
      for (const [, body] of soldOut) expect(body).toEqual({ error: 'sold_out' });

      const { rows } = await pool.query<{ n: number }>('SELECT count(*) AS n FROM tickets WHERE event_id = $1', [ev.id]);
      expect(rows[0].n).toBe(CAPACITY);
      const listed = (await (await fetch(`${base}/api/partner/events`, { headers: { 'x-api-key': config.partnerApiKey } })).json()) as Array<{
        id: string;
        availableSeats: number;
      }>;
      expect(listed.find((e) => e.id === ev.id)?.availableSeats).toBe(0);
    });
  }
});
