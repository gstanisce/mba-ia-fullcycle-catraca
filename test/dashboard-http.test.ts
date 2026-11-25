import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import { purchaseTicket } from '../src/features/purchases/service.js';
import { FORM_HEADERS, form, loginAs, resetDb, SEED } from './helpers.js';
import { newEvent, waitForStatus } from './purchases-helpers.js';

let app: FastifyInstance;
let jarA: string;
let jarB: string;

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
  jarA = await loginAs(app, SEED.organizerA.email, SEED.organizerA.password);
  jarB = await loginAs(app, SEED.organizerB.email, SEED.organizerB.password);
});

const get = (url: string, cookie: string) => app.inject({ method: 'GET', url, headers: { cookie } });
const post = (url: string, fields: Record<string, string>, cookie: string) =>
  app.inject({ method: 'POST', url, headers: { ...FORM_HEADERS, cookie }, payload: form(fields) });

const LABELS = ['Confirmados', 'Pendentes', 'Check-ins', 'Vagas disponíveis', 'Receita', 'Estornados'];

/** Values of the page's `<dd data-metric="…">`, keyed by metric. */
function metrics(body: string): Record<string, string> {
  return Object.fromEntries([...body.matchAll(/<dd data-metric="([a-z]+)">([^<]*)<\/dd>/g)].map((m) => [m[1], m[2]]));
}

/** Buys through the partner channel and waits for the poller to confirm it. */
async function confirmedTicket(eventId: string): Promise<{ id: string; code: string }> {
  const res = await purchaseTicket({ eventId, buyerEmail: 'p@x.com', cardNumber: '4000000000000001', userId: null, channel: 'api' });
  if (!res.ok) throw new Error(res.error);
  expect((await waitForStatus(res.ticket.id, async () => {}, 10_000)).status).toBe('confirmed');
  return res.ticket;
}

describe('management page section Painel (F07-AC1, F07-AC2, X12)', () => {
  it('owner sees the six exact labels with their values, in order, before the other sections', async () => {
    const e = await newEvent({ capacity: 3, priceCents: 10000 });
    await confirmedTicket(e.id);
    const res = await get(`/organizer/events/${e.id}`, jarA);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<h2>Painel</h2>');
    expect(res.body).toContain('<dl id="panel">');
    let last = -1;
    for (const label of LABELS) {
      const i = res.body.indexOf(`<dt>${label}</dt>`);
      expect(i, label).toBeGreaterThan(last);
      last = i;
    }
    expect(res.body.indexOf('id="section-panel"')).toBeLessThan(res.body.indexOf('id="section-checkin"'));
    expect(metrics(res.body)).toEqual({
      confirmed: '1',
      pending: '0',
      checkins: '0',
      available: '2',
      revenue: 'R$ 100,00',
      refunded: '0',
    });
  });

  it('check-in through the page updates Check-ins and keeps Confirmados (X14)', async () => {
    const e = await newEvent({ capacity: 2 });
    const t = await confirmedTicket(e.id);
    const res = await post(`/organizer/events/${e.id}/checkin`, { code: t.code }, jarA);
    expect(res.body).toContain('Entrada liberada');
    expect(metrics(res.body)).toMatchObject({ confirmed: '1', checkins: '1' });
    expect(metrics((await get(`/organizer/events/${e.id}`, jarA)).body)).toMatchObject({ confirmed: '1', checkins: '1' });
  });

  it('cancelled event: Vagas disponíveis 0, Receita R$ 0,00, Estornados 1 (X15)', async () => {
    const e = await newEvent({ capacity: 5, priceCents: 5000 });
    await confirmedTicket(e.id);
    expect((await post(`/organizer/events/${e.id}/cancel`, {}, jarA)).statusCode).toBe(303);
    expect(metrics((await get(`/organizer/events/${e.id}`, jarA)).body)).toEqual({
      confirmed: '0',
      pending: '0',
      checkins: '0',
      available: '0',
      revenue: 'R$ 0,00',
      refunded: '1',
    });
  });

  it("organizer B gets 404 for A's event, with no panel or numbers (R13)", async () => {
    const e = await newEvent({ name: 'Show secreto', capacity: 7, priceCents: 12300 });
    await confirmedTicket(e.id);
    const res = await get(`/organizer/events/${e.id}`, jarB);
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('Evento não encontrado');
    for (const text of [...LABELS, 'Painel', 'data-metric', 'R$ 123,00', 'Show secreto']) expect(res.body).not.toContain(text);
  });
});
