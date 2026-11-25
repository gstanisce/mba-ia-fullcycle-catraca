import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { purchaseTicket } from '../src/features/purchases/service.js';
import { getTicketById, type TicketRow } from '../src/features/purchases/tickets.js';
import { FORM_HEADERS, form, loginAs, resetDb, SEED } from './helpers.js';
import { newEvent, userIdByEmail, waitForStatus } from './purchases-helpers.js';

let app: FastifyInstance;
let jarA: string;
let jarB: string;
let jarP: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready(); // starts the gateway poller (onReady)
});

afterAll(async () => {
  await app.close();
  await pool.end();
});

beforeEach(async () => {
  await resetDb();
  jarA = await loginAs(app, SEED.organizerA.email, SEED.organizerA.password);
  jarB = await loginAs(app, SEED.organizerB.email, SEED.organizerB.password);
  jarP = await loginAs(app, SEED.participant.email, SEED.participant.password);
});

const post = (url: string, fields: Record<string, string>, cookie?: string) =>
  app.inject({ method: 'POST', url, headers: { ...FORM_HEADERS, ...(cookie ? { cookie } : {}) }, payload: form(fields) });
const get = (url: string, cookie?: string) => app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

const checkin = (eventId: string, code: string, cookie = jarA) => post(`/organizer/events/${eventId}/checkin`, { code }, cookie);

/** Extracts `<p id="checkin-result" data-result="…">message</p>`. */
function resultOf(body: string): { result: string; message: string } {
  const m = /<p id="checkin-result" data-result="([a-z_]+)">([^<]*)<\/p>/.exec(body);
  if (!m) throw new Error('checkin-result not found');
  return { result: m[1]!, message: m[2]! };
}

/** Web purchase by the seed participant through F03's route (POST /events/:id/purchase). */
async function buyWeb(eventId: string, cardNumber: string): Promise<TicketRow> {
  const res = await post(`/events/${eventId}/purchase`, { cardNumber }, jarP);
  expect(res.statusCode).toBe(303);
  const userId = await userIdByEmail(SEED.participant.email);
  const { rows } = await pool.query('SELECT id FROM tickets WHERE event_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1', [
    eventId,
    userId,
  ]);
  return (await getTicketById(pool, rows[0].id))!;
}

/** Partner-channel purchase through F03's single purchase path (F04 is parallel). */
async function buyApi(eventId: string, cardNumber: string): Promise<TicketRow> {
  const res = await purchaseTicket({ eventId, buyerEmail: 'parceiro@x.com', cardNumber, userId: null, channel: 'api' });
  if (!res.ok) throw new Error(res.error);
  return res.ticket;
}

const confirmed = async (t: TicketRow) => {
  const done = await waitForStatus(t.id, undefined, 10_000); // the app's poller delivers the answer
  expect(done.status).toBe('confirmed');
  return done;
};
const holdPending = (ticketId: string) =>
  pool.query("UPDATE gateway_requests SET respond_at = now() + interval '1 hour' WHERE ticket_id = $1", [ticketId]);

async function newEventOfB(name: string) {
  const res = await post('/organizer/events', { name, startsAt: '2099-01-01T20:00', venue: 'Bar B', capacity: '3', price: '50,00' }, jarB);
  expect(res.statusCode).toBe(303);
  const id = /evt_[0-9a-z]{10}/.exec(res.headers.location as string)![0];
  expect((await post(`/organizer/events/${id}/publish`, {}, jarB)).statusCode).toBe(303);
  return id;
}

describe('check-in section on the management page (R04, X08, C05-01)', () => {
  it('shows the "Check-in" section with the code field and Validar, and no result yet', async () => {
    const event = await newEvent({ name: 'Show de Check-in' });
    const res = await get(`/organizer/events/${event.id}`, jarA);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<section id="section-checkin"><h2>Check-in</h2>');
    expect(res.body).toContain(`<form method="post" action="/organizer/events/${event.id}/checkin" id="checkin-form">`);
    expect(res.body).toContain('name="code"');
    expect(res.body).toContain('<button type="submit">Validar</button>');
    expect(res.body).not.toContain('id="checkin-result"');
  });

  it('is still available on a cancelled event', async () => {
    const event = await newEvent();
    await pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [event.id]);
    const res = await get(`/organizer/events/${event.id}`, jarA);
    expect(res.body).toContain('id="checkin-form"');
  });
});

describe('POST /organizer/events/:id/checkin — the five messages in #checkin-result (F05-AC1, F05-AC2, X09)', () => {
  it('web tickets: confirmed → liberada → já utilizado; pending → não confirmado; other event / unknown → inválido; cancelled → Evento cancelado', async () => {
    const e1 = await newEvent({ name: 'E1', capacity: 3 });
    const c1 = await confirmed(await buyWeb(e1.id, '4000000000000001'));
    const c2 = await buyWeb(e1.id, '4000000000000003');
    await holdPending(c2.id);
    const e2 = await newEventOfB('E2');
    const c3 = await confirmed(await buyWeb(e2, '4000000000000001'));

    let res = await checkin(e1.id, c1.code);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<h1>E1</h1>'); // re-rendered management page
    expect(resultOf(res.body)).toEqual({ result: 'admitted', message: 'Entrada liberada' });
    expect((await getTicketById(pool, c1.id))!.checkedInAt).not.toBeNull();

    expect(resultOf((await checkin(e1.id, c1.code)).body)).toEqual({ result: 'already_used', message: 'Ingresso já utilizado' });
    expect(resultOf((await checkin(e1.id, c2.code)).body)).toEqual({ result: 'not_confirmed', message: 'Ingresso não confirmado' });
    expect(resultOf((await checkin(e1.id, 'ZZZZZZZZ')).body)).toEqual({ result: 'invalid', message: 'Ingresso inválido para este evento' });
    expect(resultOf((await checkin(e1.id, c3.code)).body).message).toBe('Ingresso inválido para este evento');
    expect((await getTicketById(pool, c3.id))!.checkedInAt).toBeNull();

    await pool.query("UPDATE events SET status = 'cancelled' WHERE id = $1", [e1.id]);
    res = await checkin(e1.id, c2.code);
    expect(res.statusCode).toBe(200);
    expect(resultOf(res.body)).toEqual({ result: 'event_cancelled', message: 'Evento cancelado' });
    expect(resultOf((await checkin(e1.id, c1.code)).body).message).toBe('Evento cancelado');
    expect(resultOf((await checkin(e1.id, 'ZZZZZZZZ')).body).message).toBe('Ingresso inválido para este evento');
  });

  it('partner-channel tickets (channel api): confirmed → Entrada liberada; pending → Ingresso não confirmado', async () => {
    const event = await newEvent({ capacity: 3 });
    const ok = await confirmed(await buyApi(event.id, '4000000000000001'));
    const slow = await buyApi(event.id, '4000000000000003');
    await holdPending(slow.id);
    expect(resultOf((await checkin(event.id, ok.code)).body).message).toBe('Entrada liberada');
    expect(resultOf((await checkin(event.id, slow.code)).body).message).toBe('Ingresso não confirmado');
  });

  it('normalizes the typed code (lower case, spaces) — C05-09', async () => {
    const event = await newEvent();
    const t = await confirmed(await buyWeb(event.id, '4000000000000001'));
    expect(resultOf((await checkin(event.id, `  ${t.code.toLowerCase()} `)).body).message).toBe('Entrada liberada');
  });

  it('escapes the typed code (never echoed) and missing code → inválido', async () => {
    const event = await newEvent();
    const res = await checkin(event.id, '<script>alert(1)</script>');
    expect(res.body).not.toContain('<script>alert(1)</script>');
    expect(resultOf(res.body).message).toBe('Ingresso inválido para este evento');
    const empty = await post(`/organizer/events/${event.id}/checkin`, {}, jarA);
    expect(empty.statusCode).toBe(200);
    expect(resultOf(empty.body).message).toBe('Ingresso inválido para este evento');
  });

  it('10 simultaneous HTTP check-ins of the same code → exactly 1 Entrada liberada', async () => {
    const event = await newEvent();
    const t = await confirmed(await buyWeb(event.id, '4000000000000001'));
    const bodies = await Promise.all(Array.from({ length: 10 }, () => checkin(event.id, t.code)));
    const messages = bodies.map((r) => resultOf(r.body).message);
    expect(messages.filter((m) => m === 'Entrada liberada')).toHaveLength(1);
    expect(messages.filter((m) => m === 'Ingresso já utilizado')).toHaveLength(9);
  });
});

describe('isolation (R13, X08, C05-08)', () => {
  it('organizer B → 404 without event data, ticket untouched; visitor → 302 /login; participant → 403', async () => {
    const event = await newEvent({ name: 'Evento Secreto de A' });
    const t = await confirmed(await buyWeb(event.id, '4000000000000001'));

    const b = await checkin(event.id, t.code, jarB);
    expect(b.statusCode).toBe(404);
    expect(b.body).toContain('Evento não encontrado');
    expect(b.body).not.toContain('Evento Secreto de A');
    expect(b.body).not.toContain('checkin-result');
    expect((await getTicketById(pool, t.id))!.checkedInAt).toBeNull();

    const visitor = await post(`/organizer/events/${event.id}/checkin`, { code: t.code });
    expect(visitor.statusCode).toBe(302);
    expect(visitor.headers.location).toBe('/login');

    const participant = await checkin(event.id, t.code, jarP);
    expect(participant.statusCode).toBe(403);
    expect(participant.body).not.toContain('Evento Secreto de A');
    expect((await getTicketById(pool, t.id))!.checkedInAt).toBeNull();

    const unknown = await checkin('evt_doesnotexist', t.code);
    expect(unknown.statusCode).toBe(404);
  });
});
