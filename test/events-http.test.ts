import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { pool } from '../src/db.js';
import {
  listManagementSections,
  registerManagementSection,
  unregisterManagementSection,
} from '../src/features/events/management.js';
import { setPurchaseSlot } from '../src/features/events/purchase-slot.js';
import { html } from '../src/lib/html.js';
import { toDateTimeLocal } from '../src/lib/format.js';
import { newId, newTicketCode } from '../src/lib/ids.js';
import { FORM_HEADERS, form, loginAs, resetDb, SEED } from './helpers.js';

let app: FastifyInstance;
let jarA: string;
let jarB: string;
let jarP: string;

beforeAll(async () => {
  app = await buildApp();
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

afterEach(() => {
  setPurchaseSlot(null);
});

const DAY = 24 * 60 * 60 * 1000;
const inDays = (n: number) => toDateTimeLocal(new Date(Date.now() + n * DAY));
const FUTURE = inDays(30);
const YESTERDAY = inDays(-1);

const post = (url: string, fields: Record<string, string>, cookie?: string) =>
  app.inject({ method: 'POST', url, headers: { ...FORM_HEADERS, ...(cookie ? { cookie } : {}) }, payload: form(fields) });
const get = (url: string, cookie?: string) => app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

const E1_FORM = { name: 'E1', startsAt: FUTURE, venue: 'Bar', capacity: '2', price: '100,00' };

async function createE1(fields: Record<string, string> = E1_FORM): Promise<string> {
  const res = await post('/organizer/events', fields, jarA);
  expect(res.statusCode).toBe(303);
  const m = /^\/organizer\/events\/(evt_[0-9a-z]{10})$/.exec(res.headers.location as string);
  expect(m).not.toBeNull();
  return m![1]!;
}

async function eventRow(id: string) {
  const { rows } = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
  return rows[0];
}

async function countEvents(): Promise<number> {
  const { rows } = await pool.query('SELECT count(*) AS n FROM events');
  return rows[0].n;
}

async function insertTicket(eventId: string, status: string): Promise<void> {
  await pool.query(
    `INSERT INTO tickets (id, event_id, code, status, price_cents, channel, buyer_email, card_last4)
     VALUES ($1, $2, $3, $4, 10000, 'api', 'a@x.com', '0001')`,
    [newId('tkt'), eventId, newTicketCode(), status],
  );
}

describe('create event (R01, F02-AC1, F02-AC2)', () => {
  it('GET /organizer/events/new shows the form', async () => {
    const res = await get('/organizer/events/new', jarA);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('action="/organizer/events"');
    for (const name of ['name', 'startsAt', 'venue', 'capacity', 'price']) expect(res.body).toContain(`name="${name}"`);
  });

  it('valid form creates a draft and redirects to its management page (C02-01)', async () => {
    const id = await createE1();
    const row = await eventRow(id);
    expect(row).toMatchObject({ name: 'E1', venue: 'Bar', capacity: 2, price_cents: 10000, status: 'draft' });
    const page = await get(`/organizer/events/${id}`, jarA);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<h1>E1</h1>');
    expect(page.body).toContain('Rascunho');
    expect(page.body).toContain('R$ 100,00');
  });

  it('interprets the date in -03:00', async () => {
    const id = await createE1({ ...E1_FORM, startsAt: '2099-12-05T21:00' });
    expect((await eventRow(id)).starts_at.toISOString()).toBe('2099-12-06T00:00:00.000Z');
    expect((await get(`/organizer/events/${id}`, jarA)).body).toContain('05/12/2099 21:00');
  });

  it.each([
    ['capacity=0', { capacity: '0' }, 'A lotação deve ser um número inteiro maior ou igual a 1'],
    ['price=0', { price: '0' }, 'O preço deve ser maior que zero, em reais (ex.: 100,00)'],
    ['empty name', { name: '' }, 'Informe o nome do evento'],
    ['past date (C02-03)', { startsAt: YESTERDAY }, 'A data de início precisa estar no futuro'],
  ])('%s → 422 with message and no event created (C02-02)', async (_label, patch, message) => {
    const res = await post('/organizer/events', { ...E1_FORM, ...patch }, jarA);
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain(message);
    expect(res.body).toContain('action="/organizer/events"');
    expect(await countEvents()).toBe(0);
  });

  it('echoes typed values escaped', async () => {
    const res = await post('/organizer/events', { ...E1_FORM, name: '<script>x</script>', price: '0' }, jarA);
    expect(res.statusCode).toBe(422);
    expect(res.body).not.toContain('<script>x</script>');
    expect(res.body).toContain('&lt;script&gt;x&lt;/script&gt;');
  });
});

describe('organizer list and management page (R04, F02-AC5)', () => {
  it('/organizer lists own events with status and a link to the management page (C02-08)', async () => {
    const id = await createE1();
    const res = await get('/organizer', jarA);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<h1>Área do organizador</h1>');
    expect(res.body).toContain('href="/organizer/events/new"');
    expect(res.body).toContain(`href="/organizer/events/${id}">E1</a>`);
    expect(res.body).toContain('Rascunho');

    const page = await get(`/organizer/events/${id}`, jarA);
    expect(page.body).toContain(`<section id="section-edit"><h2>Editar evento</h2>`);
    expect(page.body).toContain(`action="/organizer/events/${id}"`);
    expect(page.body).toContain(`action="/organizer/events/${id}/publish"`);
    expect(page.body).toContain('Publicar');
    expect(page.body).toContain(`value="${E1_FORM.startsAt}"`);
    expect(page.body).toContain('value="100,00"');
  });

  it('edits the event (303) and shows the new values', async () => {
    const id = await createE1();
    const res = await post(`/organizer/events/${id}`, { ...E1_FORM, name: 'E1 editado', venue: 'Teatro', price: '1.234,56' }, jarA);
    expect(res.statusCode).toBe(303);
    expect(res.headers.location).toBe(`/organizer/events/${id}`);
    const page = await get(`/organizer/events/${id}`, jarA);
    expect(page.body).toContain('<h1>E1 editado</h1>');
    expect(page.body).toContain('Teatro');
    expect(page.body).toContain('R$ 1.234,56');
  });

  it('editing with a past date → 422 with the message; event unchanged (C02-04)', async () => {
    const id = await createE1();
    const before = await eventRow(id);
    const res = await post(`/organizer/events/${id}`, { ...E1_FORM, name: 'Outro', startsAt: YESTERDAY }, jarA);
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('A data de início precisa estar no futuro');
    expect(res.body).toContain('value="Outro"'); // typed values are kept in the form
    expect(await eventRow(id)).toEqual(before);
  });

  it('editing with invalid fields → 422; event unchanged', async () => {
    const id = await createE1();
    const before = await eventRow(id);
    const res = await post(`/organizer/events/${id}`, { ...E1_FORM, capacity: '0' }, jarA);
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('A lotação deve ser um número inteiro maior ou igual a 1');
    expect(await eventRow(id)).toEqual(before);
  });
});

describe('draft vs published in the showcase (R02, F02-AC3)', () => {
  it('draft is not listed and its public page is 404 (C02-05); publishing lists it (C02-06)', async () => {
    const id = await createE1();
    const home = await get('/');
    expect(home.statusCode).toBe(200);
    expect(home.body).toContain('<h1>Vitrine</h1>');
    expect(home.body).not.toContain('E1');
    const draftPage = await get(`/events/${id}`);
    expect(draftPage.statusCode).toBe(404);
    expect(draftPage.body).toContain('Evento não encontrado');
    expect(draftPage.body).not.toContain('E1');

    const pub = await post(`/organizer/events/${id}/publish`, {}, jarA);
    expect(pub.statusCode).toBe(303);
    expect(pub.headers.location).toBe(`/organizer/events/${id}`);
    const row = await eventRow(id);
    expect(row.status).toBe('published');
    expect(row.published_at).toBeInstanceOf(Date);

    const home2 = await get('/');
    expect(home2.body).toContain(`href="/events/${id}">E1</a>`);
    expect(home2.body).toContain('Bar');
    expect(home2.body).toContain('R$ 100,00');
    const page = await get(`/events/${id}`);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('<h1>E1</h1>');
    expect(page.body).toContain('Vagas disponíveis: 2');
    expect(page.body).toContain('R$ 100,00');

    const mgmt = await get(`/organizer/events/${id}`, jarA);
    expect(mgmt.body).toContain('Publicado');
    expect(mgmt.body).not.toContain(`action="/organizer/events/${id}/publish"`);
  });

  it('showcase lists events by start date and "Vagas disponíveis" follows R05', async () => {
    const later = await createE1({ ...E1_FORM, name: 'Depois', startsAt: inDays(20) });
    const sooner = await createE1({ ...E1_FORM, name: 'Antes', startsAt: inDays(10), capacity: '5' });
    await post(`/organizer/events/${later}/publish`, {}, jarA);
    await post(`/organizer/events/${sooner}/publish`, {}, jarA);
    const home = await get('/');
    expect(home.body.indexOf('Antes')).toBeLessThan(home.body.indexOf('Depois'));

    await insertTicket(sooner, 'pending');
    await insertTicket(sooner, 'confirmed');
    await insertTicket(sooner, 'declined');
    expect((await get(`/events/${sooner}`)).body).toContain('Vagas disponíveis: 3');
  });

  it('unknown public event → 404', async () => {
    expect((await get('/events/evt_doesnotexist')).statusCode).toBe(404);
  });
});

describe('capacity vs occupied seats (R03, R05, F02-AC4, C02-07)', () => {
  it('reducing below pending+confirmed → 422; increasing → 303', async () => {
    const id = await createE1();
    await post(`/organizer/events/${id}/publish`, {}, jarA);
    await insertTicket(id, 'pending');
    await insertTicket(id, 'confirmed');

    const low = await post(`/organizer/events/${id}`, { ...E1_FORM, capacity: '1' }, jarA);
    expect(low.statusCode).toBe(422);
    expect(low.body).toContain('A lotação não pode ser menor que as vagas ocupadas (2)');
    expect((await eventRow(id)).capacity).toBe(2);

    const high = await post(`/organizer/events/${id}`, { ...E1_FORM, capacity: '3' }, jarA);
    expect(high.statusCode).toBe(303);
    expect((await eventRow(id)).capacity).toBe(3);
    const page = await get(`/organizer/events/${id}`, jarA);
    expect(page.body).toContain('<dt>Lotação</dt><dd data-field="capacity">3</dd>');
    expect((await get(`/events/${id}`)).body).toContain('Vagas disponíveis: 1');
  });
});

describe('isolation between organizers (R13, F02-AC6, C02-09)', () => {
  it('B does not see A events and gets 404 without data on GET and POSTs; event unchanged', async () => {
    const id = await createE1({ ...E1_FORM, name: 'Show Secreto', capacity: '777', price: '4.321,00' });
    const before = await eventRow(id);

    const list = await get('/organizer', jarB);
    expect(list.statusCode).toBe(200);
    expect(list.body).not.toContain('Show Secreto');
    expect(list.body).not.toContain(id);

    const attempts = [
      await get(`/organizer/events/${id}`, jarB),
      await post(`/organizer/events/${id}`, { ...E1_FORM, name: 'Hackeado', capacity: '1' }, jarB),
      await post(`/organizer/events/${id}/publish`, {}, jarB),
    ];
    for (const res of attempts) {
      expect(res.statusCode).toBe(404);
      expect(res.body).toContain('Evento não encontrado');
      for (const leak of ['Show Secreto', 'Hackeado', '777', '4.321', 'Bar', id]) expect(res.body).not.toContain(leak);
    }
    expect(await eventRow(id)).toEqual(before);
    expect((await get(`/organizer/events/${id}`, jarA)).body).toContain('Show Secreto');
  });

  it('unknown event id → same 404 page', async () => {
    const res = await get('/organizer/events/evt_doesnotexist', jarA);
    expect(res.statusCode).toBe(404);
    expect(res.body).toContain('Evento não encontrado');
  });
});

describe('guards on F02 routes (X01, C02-10)', () => {
  it('visitor → 302 /login and participant → 403 on every organizer route', async () => {
    const id = await createE1({ ...E1_FORM, name: 'Show Secreto' });
    const routes: Array<[string, string]> = [
      ['GET', '/organizer'],
      ['GET', '/organizer/events/new'],
      ['POST', '/organizer/events'],
      ['GET', `/organizer/events/${id}`],
      ['POST', `/organizer/events/${id}`],
      ['POST', `/organizer/events/${id}/publish`],
    ];
    for (const [method, url] of routes) {
      const call = (cookie?: string) => (method === 'GET' ? get(url, cookie) : post(url, E1_FORM, cookie));
      const visitor = await call();
      expect(visitor.statusCode, `${method} ${url} visitor`).toBe(302);
      expect(visitor.headers.location).toBe('/login');
      const participant = await call(jarP);
      expect(participant.statusCode, `${method} ${url} participant`).toBe(403);
      expect(participant.body).toContain('Acesso restrito');
      expect(participant.body).not.toContain('Show Secreto');
    }
    expect(await countEvents()).toBe(1);
    expect((await eventRow(id)).status).toBe('draft');
  });
});

describe('cancelled event (C02-11, base for F06)', () => {
  it('edit and publish → 422; page shows "Evento cancelado" and no edit form', async () => {
    const id = await createE1();
    await post(`/organizer/events/${id}/publish`, {}, jarA);
    await pool.query("UPDATE events SET status = 'cancelled', cancelled_at = now() WHERE id = $1", [id]);
    const before = await eventRow(id);

    const edit = await post(`/organizer/events/${id}`, { ...E1_FORM, name: 'Outro' }, jarA);
    expect(edit.statusCode).toBe(422);
    expect(edit.body).toContain('Evento cancelado não pode ser editado');
    const pub = await post(`/organizer/events/${id}/publish`, {}, jarA);
    expect(pub.statusCode).toBe(422);
    expect(pub.body).toContain('Evento cancelado não pode ser publicado');
    expect(await eventRow(id)).toEqual(before);

    const page = await get(`/organizer/events/${id}`, jarA);
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain('Evento cancelado');
    expect(page.body).toContain('Cancelado');
    expect(page.body).not.toContain(`action="/organizer/events/${id}"`);
    expect(page.body).not.toContain(`action="/organizer/events/${id}/publish"`);
    expect(page.body).not.toContain('name="capacity"');

    expect((await get('/')).body).not.toContain('E1');
    expect((await get(`/events/${id}`)).statusCode).toBe(404);
  });
});

describe('extension points for later features', () => {
  it('sections render ordered by `order`, wrapped in <section id="section-{id}">, with state; same id replaces', async () => {
    const id = await createE1();
    registerManagementSection({ id: 'zz-cancel', title: 'Cancelamento', order: 90, render: () => '<p>cancel-here</p>' });
    registerManagementSection({
      id: 'zz-panel',
      title: 'Painel',
      order: 10,
      render: async ({ event, state }) => html`<p>panel ${event.name} ${String(state.x ?? 'none')}</p>`,
    });
    registerManagementSection({ id: 'zz-panel', title: 'Painel', order: 10, render: ({ event }) => html`<p>panel2 ${event.name}</p>` });
    try {
      const body = (await get(`/organizer/events/${id}`, jarA)).body;
      const iPanel = body.indexOf('<section id="section-zz-panel"><h2>Painel</h2>');
      const iEdit = body.indexOf('<section id="section-edit"><h2>Editar evento</h2>');
      const iCancel = body.indexOf('<section id="section-zz-cancel"><h2>Cancelamento</h2>');
      expect(iPanel).toBeGreaterThan(-1);
      expect(iPanel).toBeLessThan(iEdit);
      expect(iEdit).toBeLessThan(iCancel);
      expect(body).toContain('<p>panel2 E1</p>');
      expect(body).toContain('<p>cancel-here</p>');
      expect(listManagementSections().filter((s) => s.id === 'zz-panel')).toHaveLength(1);
    } finally {
      unregisterManagementSection('zz-panel');
      unregisterManagementSection('zz-cancel');
    }
  });

  it('purchase slot: empty when unregistered; receives event, user and available seats', async () => {
    const id = await createE1();
    await post(`/organizer/events/${id}/publish`, {}, jarA);
    await insertTicket(id, 'confirmed');
    setPurchaseSlot(null); // buildApp registers F03's slot; this test checks the bare extension point
    expect((await get(`/events/${id}`)).body).toContain('<div id="purchase-slot"></div>');

    setPurchaseSlot(({ event, user, available }) => html`<p>slot ${event.name} ${user?.name ?? 'visitante'} ${available}</p>`);
    expect((await get(`/events/${id}`)).body).toContain('<p>slot E1 visitante 1</p>');
    expect((await get(`/events/${id}`, jarP)).body).toContain(`<p>slot E1 ${SEED.participant.name} 1</p>`);
  });
});
