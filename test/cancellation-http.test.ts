import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { toDateTimeLocal } from '../src/lib/format.js';
import { FORM_HEADERS, form, loginAs, resetDb, SEED } from './helpers.js';
import { countTickets, waitForStatus } from './purchases-helpers.js';

let app: FastifyInstance;
let jarA: string;
let jarB: string;
let jarU: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready(); // starts the gateway poller
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

const post = (url: string, fields: Record<string, string>, cookie?: string) =>
  app.inject({ method: 'POST', url, headers: { ...FORM_HEADERS, ...(cookie ? { cookie } : {}) }, payload: form(fields) });
const get = (url: string, cookie?: string) => app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

beforeEach(async () => {
  await resetDb();
  jarA = await loginAs(app, SEED.organizerA.email, SEED.organizerA.password);
  jarB = await loginAs(app, SEED.organizerB.email, SEED.organizerB.password);
  jarU = await loginAs(app, SEED.participant.email, SEED.participant.password);
});

const FUTURE = toDateTimeLocal(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
const EDIT_FIELDS = { name: 'Novo nome', startsAt: FUTURE, venue: 'Outro', capacity: '9', price: '10,00' };

async function createEvent(name: string, capacity: number, publish = true): Promise<string> {
  const res = await post('/organizer/events', { name, startsAt: FUTURE, venue: 'Bar', capacity: String(capacity), price: '50,00' }, jarA);
  expect(res.statusCode).toBe(303);
  const id = /evt_[0-9a-z]{10}/.exec(res.headers.location as string)![0];
  if (publish) expect((await post(`/organizer/events/${id}/publish`, {}, jarA)).statusCode).toBe(303);
  return id;
}

async function eventStatus(id: string): Promise<string> {
  const { rows } = await pool.query('SELECT status FROM events WHERE id = $1', [id]);
  return rows[0].status;
}

async function ticketIdsByCard(eventId: string): Promise<Record<string, string>> {
  const { rows } = await pool.query('SELECT id, card_last4 FROM tickets WHERE event_id = $1', [eventId]);
  return Object.fromEntries(rows.map((r) => [r.card_last4, r.id]));
}

describe('management page section Cancelamento (F06-AC1)', () => {
  it('published event shows the Cancelar evento button', async () => {
    const id = await createEvent('E3', 5);
    const res = await get(`/organizer/events/${id}`, jarA);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<section id="section-cancel"><h2>Cancelamento</h2>');
    expect(res.body).toContain(`action="/organizer/events/${id}/cancel"`);
    expect(res.body).toContain('Cancelar evento');
    expect(res.body).toContain('irreversível');
  });

  it('draft shows the explanation and no button', async () => {
    const id = await createEvent('E9', 5, false);
    const res = await get(`/organizer/events/${id}`, jarA);
    expect(res.body).toContain('Somente eventos publicados podem ser cancelados');
    expect(res.body).not.toContain('id="cancel-event"');
  });
});

describe('POST /organizer/events/:id/cancel', () => {
  it('cancels: confirmed → estornado, pending → cancelado; late answer keeps them (F06-AC2/AC3)', async () => {
    const id = await createEvent('E3', 5);
    expect((await post(`/events/${id}/purchase`, { cardNumber: '4000000000000003' }, jarU)).statusCode).toBe(303);
    expect((await post(`/events/${id}/purchase`, { cardNumber: '4000000000000001' }, jarU)).statusCode).toBe(303);
    const { '0003': t5, '0001': t6 } = await ticketIdsByCard(id);
    // Keep T5's answer in the future until we cancel (the real window is 30–38 s; gates scale it to ~0.3 s).
    await pool.query("UPDATE gateway_requests SET respond_at = now() + interval '1 second' WHERE ticket_id = $1", [t5]);
    expect((await waitForStatus(t6!)).status).toBe('confirmed'); // the app's poller delivers it
    const { rows: t5rows } = await pool.query('SELECT status FROM tickets WHERE id = $1', [t5]);
    expect(t5rows[0].status).toBe('pending');

    const res = await post(`/organizer/events/${id}/cancel`, {}, jarA);
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe(`/organizer/events/${id}`);
    expect(await eventStatus(id)).toBe('cancelled');

    const statuses = async () =>
      Object.fromEntries((await pool.query('SELECT id, status FROM tickets WHERE event_id = $1', [id])).rows.map((r) => [r.id, r.status]));
    expect(await statuses()).toEqual({ [t5!]: 'cancelled', [t6!]: 'refunded' });
    const mine = await get('/my-tickets', jarU);
    expect(mine.body).toContain('estornado');
    expect(mine.body).toContain('cancelado');

    // Wait for t5's (approved) gateway answer to be delivered by the poller, then re-check.
    const deadline = Date.now() + 5000;
    for (;;) {
      const { rows } = await pool.query('SELECT delivered_at FROM gateway_requests WHERE ticket_id = $1', [t5]);
      if (rows[0].delivered_at) break;
      if (Date.now() > deadline) throw new Error('late answer not delivered');
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(await statuses()).toEqual({ [t5!]: 'cancelled', [t6!]: 'refunded' });
  });

  it('after cancel: management page shows Evento cancelado, no edit form, no cancel button; edit/publish → 422 (F06-AC4)', async () => {
    const id = await createEvent('E3', 5);
    expect((await post(`/organizer/events/${id}/cancel`, {}, jarA)).statusCode).toBe(303);

    const page = await get(`/organizer/events/${id}`, jarA);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Evento cancelado');
    expect(page.body).not.toContain('id="edit-event"');
    expect(page.body).not.toContain('id="publish-event"');
    expect(page.body).not.toContain('id="cancel-event"');
    expect(page.body).not.toContain('Cancelar evento');

    const edit = await post(`/organizer/events/${id}`, EDIT_FIELDS, jarA);
    expect(edit.statusCode).toBe(422);
    const publish = await post(`/organizer/events/${id}/publish`, {}, jarA);
    expect(publish.statusCode).toBe(422);
    expect(await eventStatus(id)).toBe('cancelled');
    const { rows } = await pool.query('SELECT name FROM events WHERE id = $1', [id]);
    expect(rows[0].name).toBe('E3');
  });

  it('second cancel is refused with Evento já cancelado (irreversible)', async () => {
    const id = await createEvent('E3', 5);
    expect((await post(`/organizer/events/${id}/cancel`, {}, jarA)).statusCode).toBe(303);
    const again = await post(`/organizer/events/${id}/cancel`, {}, jarA);
    expect(again.statusCode).toBe(422);
    expect(again.body).toContain('Evento já cancelado');
    expect(await eventStatus(id)).toBe('cancelled');
  });

  it('draft cannot be cancelled', async () => {
    const id = await createEvent('E9', 5, false);
    const res = await post(`/organizer/events/${id}/cancel`, {}, jarA);
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('Somente eventos publicados podem ser cancelados');
    expect(await eventStatus(id)).toBe('draft');
  });

  it('organizer B gets 404 without data; the event stays published (R13)', async () => {
    const id = await createEvent('Evento secreto de A', 5);
    const res = await post(`/organizer/events/${id}/cancel`, {}, jarB);
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('Evento não encontrado');
    expect(res.body).not.toContain('Evento secreto de A');
    expect(await eventStatus(id)).toBe('published');
    expect((await post('/organizer/events/evt_nope000000/cancel', {}, jarA)).statusCode).toBe(404);
  });

  it('only organizers: visitor → login, participant → 403', async () => {
    const id = await createEvent('E3', 5);
    const visitor = await post(`/organizer/events/${id}/cancel`, {});
    expect(visitor.statusCode).toBe(302);
    expect(visitor.headers.location).toBe('/login');
    expect((await post(`/organizer/events/${id}/cancel`, {}, jarU)).statusCode).toBe(403);
    expect(await eventStatus(id)).toBe('published');
  });
});

describe('a cancelled event leaves the showcase and does not sell (X10, X11)', () => {
  it('absent from /, public page 404, purchase 404 Evento não disponível and no new ticket', async () => {
    const id = await createEvent('Evento Cancelável', 5);
    expect((await get('/')).body).toContain('Evento Cancelável');
    expect((await post(`/organizer/events/${id}/cancel`, {}, jarA)).statusCode).toBe(303);

    expect((await get('/')).body).not.toContain('Evento Cancelável');
    expect((await get(`/events/${id}`)).statusCode).toBe(404);
    const before = await countTickets(id);
    const buy = await post(`/events/${id}/purchase`, { cardNumber: '4000000000000001' }, jarU);
    expect(buy.statusCode).toBe(404);
    expect(buy.body).toContain('Evento não disponível');
    expect(await countTickets(id)).toBe(before);
  });
});
