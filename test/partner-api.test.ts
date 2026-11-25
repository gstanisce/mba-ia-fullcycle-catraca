import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { pool } from '../src/db.js';
import { isValidApiKey } from '../src/features/partner-api/plugin.js';
import { FORM_HEADERS, form, loginAs, resetDb, SEED } from './helpers.js';
import { countTickets, newEvent, waitForStatus } from './purchases-helpers.js';

let app: FastifyInstance;
const KEY = config.partnerApiKey;
const JSON_HEADERS = { 'content-type': 'application/json', 'x-api-key': KEY } as const;
const VALID = { buyerEmail: 't@x.com', cardNumber: '4000000000000001' };

beforeAll(async () => {
  app = await buildApp();
  await app.ready(); // starts the gateway poller
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await resetDb();
});

const listEvents = (key: string | undefined = KEY) =>
  app.inject({ method: 'GET', url: '/api/partner/events', headers: key === undefined ? {} : { 'x-api-key': key } });
const buy = (eventId: string, body: unknown = VALID) =>
  app.inject({ method: 'POST', url: `/api/partner/events/${eventId}/purchases`, headers: JSON_HEADERS, payload: JSON.stringify(body) });
const getTicket = (id: string) => app.inject({ method: 'GET', url: `/api/partner/tickets/${id}`, headers: { 'x-api-key': KEY } });

async function availableOf(eventId: string): Promise<number | undefined> {
  const list = (await listEvents()).json() as Array<{ id: string; availableSeats: number }>;
  return list.find((e) => e.id === eventId)?.availableSeats;
}

async function webPurchase(eventId: string): Promise<string> {
  const jar = await loginAs(app, SEED.participant.email, SEED.participant.password);
  const res = await app.inject({
    method: 'POST',
    url: `/events/${eventId}/purchase`,
    headers: { ...FORM_HEADERS, cookie: jar },
    payload: form({ cardNumber: '4000000000000001' }),
  });
  expect(res.statusCode).toBe(303);
  return jar;
}

describe('X-Api-Key (F04-AC1, C04-01, C04-02)', () => {
  const routes = [
    { method: 'GET' as const, url: '/api/partner/events' },
    { method: 'POST' as const, url: '/api/partner/events/x/purchases' },
    { method: 'GET' as const, url: '/api/partner/tickets/x' },
  ];
  const badHeaders: Array<[string, Record<string, string>]> = [
    ['no key', {}],
    ['wrong key', { 'x-api-key': 'errada' }],
    ['key in another case', { 'x-api-key': KEY.toUpperCase() }],
    ['key prefix', { 'x-api-key': KEY.slice(0, -1) }],
  ];

  for (const r of routes) {
    for (const [label, headers] of badHeaders) {
      it(`${r.method} ${r.url} with ${label} → 401 unauthorized`, async () => {
        const res = await app.inject({ method: r.method, url: r.url, headers });
        expect(res.statusCode).toBe(401);
        expect(res.json()).toEqual({ error: 'unauthorized' });
      });
    }
  }

  it('401 comes before body parsing and validation (invalid JSON without key)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/partner/events/x/purchases',
      headers: { 'content-type': 'application/json' },
      payload: 'not json',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthorized' });
  });

  it('isValidApiKey: only the exact configured key', () => {
    expect(isValidApiKey(KEY)).toBe(true);
    expect(isValidApiKey(undefined)).toBe(false);
    expect(isValidApiKey(['a', 'b'])).toBe(false);
    expect(isValidApiKey('')).toBe(false);
    expect(isValidApiKey(`${KEY}x`)).toBe(false);
  });

  it('does not leak to other routes (web pages need no key)', async () => {
    expect((await app.inject({ method: 'GET', url: '/' })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });
});

describe('GET /api/partner/events (F04-AC2, X05, C04-03, C04-04)', () => {
  it('draft out, published in, cancelled out; exactly the contract fields', async () => {
    const draft = await newEvent({ name: 'Rascunho' }, { draft: true });
    const pub = await newEvent({ name: 'E1', capacity: 2, priceCents: 10000 });
    const cancelled = await newEvent({ name: 'Cancelado' });
    await pool.query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [cancelled.id]);

    const res = await listEvents();
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    const list = res.json() as Array<Record<string, unknown>>;
    const ids = list.map((e) => e.id);
    expect(ids).toContain(pub.id);
    expect(ids).not.toContain(draft.id);
    expect(ids).not.toContain(cancelled.id);

    for (const item of list) {
      expect(Object.keys(item).sort()).toEqual(['availableSeats', 'id', 'name', 'priceCents', 'startsAt']);
    }
    const e1 = list.find((e) => e.id === pub.id)!;
    expect(e1).toEqual({
      id: pub.id,
      name: 'E1',
      startsAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/),
      priceCents: 10000,
      availableSeats: 2,
    });
    expect(new Date(e1.startsAt as string).getTime()).toBe(Math.floor(pub.startsAt.getTime() / 1000) * 1000);
  });

  it('a draft appears once published', async () => {
    const draft = await newEvent({}, { draft: true });
    expect(await availableOf(draft.id)).toBeUndefined();
    await pool.query("UPDATE events SET status = 'published', published_at = now() WHERE id = $1", [draft.id]);
    expect(await availableOf(draft.id)).toBe(2);
  });

  it('availableSeats reflects web (F03) and API sales (X05, R05)', async () => {
    const ev = await newEvent({ capacity: 3 });
    await webPurchase(ev.id);
    expect(await availableOf(ev.id)).toBe(2);
    expect((await buy(ev.id)).statusCode).toBe(202);
    expect(await availableOf(ev.id)).toBe(1);
  });

  it('no event on sale → 200 []', async () => {
    const res = await listEvents();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('POST /api/partner/events/:id/purchases (F04-AC3, F04-AC4)', () => {
  it('valid → 202 {ticketId, code, status: pending}, channel api, no user (C04-05)', async () => {
    const ev = await newEvent();
    const res = await buy(ev.id);
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(Object.keys(body).sort()).toEqual(['code', 'status', 'ticketId']);
    expect(body.status).toBe('pending');
    expect(body.ticketId).toMatch(/^tkt_[0-9a-z]{10}$/);
    expect(body.code).toMatch(/^[A-Z2-9]{8}$/);
    const { rows } = await pool.query('SELECT channel, user_id, buyer_email, card_last4, code FROM tickets WHERE id = $1', [body.ticketId]);
    expect(rows[0]).toEqual({ channel: 'api', user_id: null, buyer_email: 't@x.com', card_last4: '0001', code: body.code });
  });

  describe('422 invalid_request (C04-08)', () => {
    const invalidBodies: Array<[string, unknown]> = [
      ['card with 3 digits', { buyerEmail: 't@x.com', cardNumber: '123' }],
      ['card with 17 digits', { buyerEmail: 't@x.com', cardNumber: '40000000000000011' }],
      ['card with a letter', { buyerEmail: 't@x.com', cardNumber: '400000000000000a' }],
      ['card as a number', { buyerEmail: 't@x.com', cardNumber: 4000000000000001 }],
      ['missing buyerEmail', { cardNumber: '4000000000000001' }],
      ['missing cardNumber', { buyerEmail: 't@x.com' }],
      ['malformed e-mail', { buyerEmail: 'abc', cardNumber: '4000000000000001' }],
      ['empty object', {}],
      ['JSON array', [VALID]],
      ['JSON null', null],
      ['JSON string', 'oi'],
    ];
    for (const [label, body] of invalidBodies) {
      it(label, async () => {
        const ev = await newEvent();
        const res = await buy(ev.id, body);
        expect(res.statusCode).toBe(422);
        expect(res.json()).toEqual({ error: 'invalid_request' });
        expect(await countTickets(ev.id)).toBe(0);
      });
    }

    const rawBodies: Array<[string, string, string]> = [
      ['not json (application/json)', 'application/json', 'not json'],
      ['empty application/json body', 'application/json', ''],
      ['truncated JSON', 'application/json', '{"buyerEmail":"t@x.com",'],
      ['text/plain', 'text/plain', JSON.stringify(VALID)],
      ['form-urlencoded "not json"', 'application/x-www-form-urlencoded', 'not json'],
    ];
    for (const [label, type, payload] of rawBodies) {
      it(label, async () => {
        const ev = await newEvent();
        const res = await app.inject({
          method: 'POST',
          url: `/api/partner/events/${ev.id}/purchases`,
          headers: { 'x-api-key': KEY, 'content-type': type },
          payload,
        });
        expect(res.statusCode).toBe(422);
        expect(res.json()).toEqual({ error: 'invalid_request' });
        expect(await countTickets(ev.id)).toBe(0);
      });
    }

    it('no body at all', async () => {
      const ev = await newEvent();
      const res = await app.inject({ method: 'POST', url: `/api/partner/events/${ev.id}/purchases`, headers: { 'x-api-key': KEY } });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ error: 'invalid_request' });
    });
  });

  it('404 event_not_available: missing, draft, cancelled (C04-09)', async () => {
    const draft = await newEvent({}, { draft: true });
    const cancelled = await newEvent();
    await pool.query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [cancelled.id]);
    for (const id of ['evt_naoexiste', draft.id, cancelled.id]) {
      const res = await buy(id);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'event_not_available' });
    }
    expect(await countTickets()).toBe(0);
  });

  it('409 sold_out when no seat is left (C04-10)', async () => {
    const ev = await newEvent({ capacity: 1 });
    expect((await buy(ev.id)).statusCode).toBe(202);
    const res = await buy(ev.id, { buyerEmail: 'b@x.com', cardNumber: '4000000000000001' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'sold_out' });
    expect(await countTickets(ev.id)).toBe(1);
  });

  it('error order 422 → 404 → 409 (C04-11)', async () => {
    // Invalid body on a missing event → 422.
    let res = await buy('evt_naoexiste', { buyerEmail: 'abc', cardNumber: '1' });
    expect([res.statusCode, res.json()]).toEqual([422, { error: 'invalid_request' }]);
    res = await app.inject({
      method: 'POST',
      url: '/api/partner/events/evt_naoexiste/purchases',
      headers: JSON_HEADERS,
      payload: 'not json',
    });
    expect([res.statusCode, res.json()]).toEqual([422, { error: 'invalid_request' }]);

    // Invalid body on a sold-out event → 422.
    const ev = await newEvent({ capacity: 1 });
    expect((await buy(ev.id)).statusCode).toBe(202);
    res = await buy(ev.id, { buyerEmail: 'abc', cardNumber: '4000000000000001' });
    expect([res.statusCode, res.json()]).toEqual([422, { error: 'invalid_request' }]);

    // Valid body on a sold-out draft (set directly in the DB, keeping its ticket) → 404, not 409.
    await pool.query("UPDATE events SET status = 'draft' WHERE id = $1", [ev.id]);
    res = await buy(ev.id);
    expect([res.statusCode, res.json()]).toEqual([404, { error: 'event_not_available' }]);
  });
});

describe('GET /api/partner/tickets/:id (F04-AC6, X06, X07)', () => {
  it('404 ticket_not_found (C04-12)', async () => {
    const res = await getTicket('tkt_nao_existe');
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'ticket_not_found' });
  });

  it('0001: pending → confirmed with exact fields; checkedIn follows checked_in_at (C04-06, X06)', async () => {
    const ev = await newEvent();
    const { ticketId, code } = (await buy(ev.id)).json();
    let res = await getTicket(ticketId);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ticketId, code, eventId: ev.id, status: 'pending', checkedIn: false });

    const t = await waitForStatus(ticketId); // poller delivers it (scale 0.01 → 20–45 ms), polling up to 2 s
    expect(t.status).toBe('confirmed');
    res = await getTicket(ticketId);
    expect(res.json()).toEqual({ ticketId, code, eventId: ev.id, status: 'confirmed', checkedIn: false });

    await pool.query('UPDATE tickets SET checked_in_at = now() WHERE id = $1', [ticketId]);
    expect((await getTicket(ticketId)).json()).toEqual({ ticketId, code, eventId: ev.id, status: 'confirmed', checkedIn: true });
  });

  it('0004: declined after the slow answer and the seat comes back (C04-07, X06)', async () => {
    const ev = await newEvent({ capacity: 1 });
    const res = await buy(ev.id, { buyerEmail: 't@x.com', cardNumber: '4000000000000004' });
    expect(res.statusCode).toBe(202);
    const { ticketId } = res.json();
    expect(await availableOf(ev.id)).toBe(0);
    expect((await buy(ev.id)).statusCode).toBe(409);

    const t = await waitForStatus(ticketId, async () => {}, 3000); // 300–380 ms at scale 0.01
    expect(t.status).toBe('declined');
    expect((await getTicket(ticketId)).json().status).toBe('declined');
    expect(await availableOf(ev.id)).toBe(1);
  });

  it('a showcase (web) ticket is visible with the same code shown in "Meus ingressos" (C04-14, X07)', async () => {
    const ev = await newEvent();
    const jar = await webPurchase(ev.id);
    const page = (await app.inject({ method: 'GET', url: '/my-tickets', headers: { cookie: jar } })).body;
    const m = /<tr data-ticket-id="(tkt_[0-9a-z]+)">.*?<td data-field="code"><code>([^<]+)<\/code>/.exec(page);
    expect(m).not.toBeNull();
    const [, ticketId, shownCode] = m!;

    const res = await getTicket(ticketId);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ticketId, code: shownCode, eventId: ev.id, status: expect.any(String), checkedIn: false });
  });
});
