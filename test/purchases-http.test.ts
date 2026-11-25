import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { toDateTimeLocal } from '../src/lib/format.js';
import { FORM_HEADERS, form, loginAs, resetDb, SEED } from './helpers.js';
import { countTickets, waitForStatus } from './purchases-helpers.js';

let app: FastifyInstance;
let jarA: string;
let jarP: string;
let jarU: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready(); // starts the gateway poller (onReady)
});

afterAll(async () => {
  await app.close(); // stops the poller (onClose)
  await pool.end();
});

const post = (url: string, fields: Record<string, string>, cookie?: string) =>
  app.inject({ method: 'POST', url, headers: { ...FORM_HEADERS, ...(cookie ? { cookie } : {}) }, payload: form(fields) });
const get = (url: string, cookie?: string) => app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

beforeEach(async () => {
  await resetDb();
  jarA = await loginAs(app, SEED.organizerA.email, SEED.organizerA.password);
  jarP = await loginAs(app, SEED.participant.email, SEED.participant.password);
  const res = await post('/signup', { name: 'Usuária Nova', email: 'u@x.com', password: 'segredo1' });
  const sid = res.cookies.find((c) => c.name === 'sid');
  if (!sid) throw new Error('signup failed');
  jarU = `sid=${sid.value}`;
});

const FUTURE = toDateTimeLocal(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));

/** Creates (and publishes, unless draft) an event of organizer A through F02's routes. */
async function createEvent(name: string, capacity: number, price = '100,00', publish = true): Promise<string> {
  const res = await post('/organizer/events', { name, startsAt: FUTURE, venue: 'Bar', capacity: String(capacity), price }, jarA);
  expect(res.statusCode).toBe(303);
  const id = /evt_[0-9a-z]{10}/.exec(res.headers.location as string)![0];
  if (publish) expect((await post(`/organizer/events/${id}/publish`, {}, jarA)).statusCode).toBe(303);
  return id;
}

const purchase = (eventId: string, cardNumber: string, cookie = jarU) =>
  post(`/events/${eventId}/purchase`, { cardNumber }, cookie);

async function latestTicketId(eventId: string): Promise<string> {
  const { rows } = await pool.query('SELECT id FROM tickets WHERE event_id = $1 ORDER BY created_at DESC LIMIT 1', [eventId]);
  return rows[0].id;
}

function rowOf(body: string, ticketId: string): string {
  const m = new RegExp(`<tr data-ticket-id="${ticketId}">.*?</tr>`).exec(body);
  if (!m) throw new Error(`row ${ticketId} not found`);
  return m[0];
}

describe('purchase slot on the public event page (X03, F03-AC5)', () => {
  it('visitor: "Entre para comprar" → /login; organizer: only participants; participant: card form', async () => {
    const id = await createEvent('E1', 2);
    const visitor = (await get(`/events/${id}`)).body;
    expect(visitor).toContain('<a href="/login">Entre para comprar</a>');
    expect(visitor).not.toContain('name="cardNumber"');
    const org = (await get(`/events/${id}`, jarA)).body;
    expect(org).toContain('Somente participantes compram ingressos');
    expect(org).not.toContain('name="cardNumber"');
    const part = (await get(`/events/${id}`, jarU)).body;
    expect(part).toContain(`<form method="post" action="/events/${id}/purchase"`);
    expect(part).toContain('name="cardNumber"');
    expect(part).toContain('<button type="submit">Comprar</button>');
  });
});

describe('web purchase (R06, R08, R09, F03-AC1, F03-AC2, F03-AC7)', () => {
  it('0001: 303 → /my-tickets with pendente and an 8-char code, then confirmado (C03-01, C03-02)', async () => {
    const id = await createEvent('E1', 2);
    const res = await purchase(id, '4000000000000001');
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe('/my-tickets');
    const ticketId = await latestTicketId(id);
    const page = await get('/my-tickets', jarU);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<h1>Meus ingressos</h1>');
    expect(page.body).toContain('<th>Evento</th><th>Data</th><th>Status</th><th>Código</th>');
    const row = rowOf(page.body, ticketId);
    expect(row).toContain('<td>E1</td>');
    expect(row).toContain('<td data-field="status">pendente</td>');
    expect(row).toMatch(/<code>[A-Z2-9]{8}<\/code>/);
    // The app's own poller (started on ready) delivers the answer: no manual cycle here.
    expect((await waitForStatus(ticketId)).status).toBe('confirmed');
    expect(rowOf((await get('/my-tickets', jarU)).body, ticketId)).toContain('<td data-field="status">confirmado</td>');
  });

  it('0002: sold out while pending, then recusado and the seat is free again (C03-03)', async () => {
    const id = await createEvent('E2', 1);
    expect((await purchase(id, '4000000000000002')).statusCode).toBe(303);
    const ticketId = await latestTicketId(id);
    const during = (await get(`/events/${id}`, jarU)).body;
    expect(during).toContain('Ingressos esgotados');
    expect(during).not.toContain('name="cardNumber"');
    expect((await waitForStatus(ticketId)).status).toBe('declined');
    expect(rowOf((await get('/my-tickets', jarU)).body, ticketId)).toContain('recusado');
    const after = (await get(`/events/${id}`, jarU)).body;
    expect(after).toContain('Vagas disponíveis: 1');
    expect(after).toContain('name="cardNumber"');
  });

  it('invalid card → 422 with the 16-digit message; no ticket (C03-04, F03-AC3)', async () => {
    const id = await createEvent('E1', 2);
    for (const card of ['123', '40000000000000011', 'abcdabcdabcdabcd', '']) {
      const res = await purchase(id, card);
      expect(res.statusCode).toBe(422);
      expect(res.body).toContain('O número do cartão deve ter 16 dígitos');
      expect(res.body).toContain('name="cardNumber"');
    }
    const noField = await post(`/events/${id}/purchase`, {}, jarU);
    expect(noField.statusCode).toBe(422);
    expect(await countTickets()).toBe(0);
  });

  it('sold out: page shows "Ingressos esgotados" without form; POST → 409 with the message (C03-05, R07)', async () => {
    const id = await createEvent('E3', 1);
    expect((await purchase(id, '4000000000000001')).statusCode).toBe(303);
    const page = (await get(`/events/${id}`, jarP)).body;
    expect(page).toContain('<p class="sold-out">Ingressos esgotados</p>');
    expect(page).not.toContain('<form method="post" action="/events/');
    const res = await purchase(id, '4000000000000001', jarP);
    expect(res.statusCode).toBe(409);
    expect(res.body).toContain('Ingressos esgotados');
    expect(res.body).not.toContain('name="cardNumber"');
    expect(await countTickets(id)).toBe(1);
  });

  it('0003 keeps the seat while pending (C03-06)', async () => {
    const id = await createEvent('E4', 1);
    expect((await purchase(id, '4000000000000003')).statusCode).toBe(303);
    const ticketId = await latestTicketId(id);
    expect((await get(`/events/${id}`)).body).toContain('Ingressos esgotados');
    const { rows } = await pool.query('SELECT status FROM tickets WHERE id = $1', [ticketId]);
    expect(rows[0].status).toBe('pending');
    expect((await waitForStatus(ticketId)).status).toBe('confirmed');
  });

  it('/my-tickets shows only the owner tickets, newest first (C03-09, R09)', async () => {
    const e1 = await createEvent('Show Um', 5);
    const e2 = await createEvent('Show Dois', 5);
    expect((await purchase(e1, '4000000000000001')).statusCode).toBe(303);
    expect((await purchase(e2, '4000000000000003')).statusCode).toBe(303);
    expect((await purchase(e1, '4000000000000001', jarP)).statusCode).toBe(303);
    const mine = (await get('/my-tickets', jarU)).body;
    expect(mine.indexOf('Show Dois')).toBeGreaterThan(-1);
    expect(mine.indexOf('Show Dois')).toBeLessThan(mine.indexOf('Show Um'));
    expect(mine.match(/data-ticket-id=/g)).toHaveLength(2);
    const other = (await get('/my-tickets', jarP)).body;
    expect(other.match(/data-ticket-id=/g)).toHaveLength(1);
    const { rows } = await pool.query('SELECT id, code, user_id FROM tickets');
    const { rows: users } = await pool.query("SELECT id FROM users WHERE email = 'u@x.com'");
    for (const t of rows) {
      if (t.user_id === users[0].id) expect(other).not.toContain(t.code);
      else expect(mine).not.toContain(t.code);
    }
    const { rows: uniq } = await pool.query('SELECT count(DISTINCT code) AS d, count(*) AS n FROM tickets');
    expect(uniq[0].d).toBe(uniq[0].n);
  });

  it('participant without tickets sees an empty state', async () => {
    const res = await get('/my-tickets', jarU);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Você ainda não tem ingressos.');
  });
});

describe('guards (X02, C03-12)', () => {
  it('visitor → 302 /login; organizer → 403; on purchase and /my-tickets; nothing created', async () => {
    const id = await createEvent('E1', 2);
    const v = await purchase(id, '4000000000000001', '');
    expect(v.statusCode).toBe(302);
    expect(v.headers.location).toBe('/login');
    expect((await purchase(id, '4000000000000001', jarA)).statusCode).toBe(403);
    const vt = await get('/my-tickets');
    expect(vt.statusCode).toBe(302);
    expect(vt.headers.location).toBe('/login');
    expect((await get('/my-tickets', jarA)).statusCode).toBe(403);
    expect(await countTickets()).toBe(0);
  });
});

describe('only events on sale accept purchases (X03, C03-13)', () => {
  it('draft, cancelled and unknown → 404 "Evento não disponível"; no ticket', async () => {
    const draft = await createEvent('E7', 2, '100,00', false);
    const r1 = await purchase(draft, '4000000000000001');
    expect(r1.statusCode).toBe(404);
    expect(r1.body).toContain('Evento não disponível');
    expect(r1.body).not.toContain('E7');
    const cancelled = await createEvent('E9', 2);
    await pool.query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [cancelled]);
    expect((await purchase(cancelled, '4000000000000001')).statusCode).toBe(404);
    expect((await purchase('evt_missing000', '4000000000000001')).statusCode).toBe(404);
    // Invalid card on an event that is not on sale: there is no event page to re-render.
    expect((await purchase(draft, '123')).statusCode).toBe(404);
    expect(await countTickets()).toBe(0);
  });
});

describe('web purchases count in F02 capacity edit (X04, C03-14)', () => {
  it('1 pending + 1 confirmed: capacity 1 → 422 message; capacity 3 → 303', async () => {
    const id = await createEvent('E8', 2);
    expect((await purchase(id, '4000000000000003')).statusCode).toBe(303);
    const pendingId = await latestTicketId(id);
    expect((await purchase(id, '4000000000000001', jarP)).statusCode).toBe(303);
    const confirmedId = await latestTicketId(id);
    expect((await waitForStatus(confirmedId)).status).toBe('confirmed');
    const { rows } = await pool.query('SELECT status FROM tickets WHERE id = $1', [pendingId]);
    expect(rows[0].status).toBe('pending');
    const fields = { name: 'E8', startsAt: FUTURE, venue: 'Bar', price: '100,00' };
    const bad = await post(`/organizer/events/${id}`, { ...fields, capacity: '1' }, jarA);
    expect(bad.statusCode).toBe(422);
    expect(bad.body).toContain('A lotação não pode ser menor que as vagas ocupadas (2)');
    expect((await post(`/organizer/events/${id}`, { ...fields, capacity: '3' }, jarA)).statusCode).toBe(303);
  });
});
