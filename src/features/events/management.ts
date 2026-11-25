import type { FastifyReply } from 'fastify';
import type { Db } from '../../db.js';
import { formatBRL, formatDateTime, formatPriceInput, toDateTimeLocal } from '../../lib/format.js';
import { html, raw, SafeHtml } from '../../lib/html.js';
import { layout, type SessionUser } from '../../lib/layout.js';
import { EVENT_STATUS_LABELS, type EventRow } from './repo.js';
import type { EventFormValues } from './validation.js';

/** Everything a management-page section needs. `state[sectionId]` carries the result of that section's POST. */
export interface ManagementContext {
  event: EventRow;
  user: SessionUser;
  state: Record<string, unknown>;
  db: Db;
}

/**
 * A block of the organizer's event page (`/organizer/events/:id`). A string returned by `render` is emitted
 * as-is (trusted HTML): escape user data with the `html` tag. Reserved orders: panel 10 (F07), checkin 20 (F05),
 * edit 50 (F02), cancel 90 (F06).
 */
export interface ManagementSection {
  id: string;
  title: string;
  order: number;
  render(ctx: ManagementContext): string | SafeHtml | Promise<string | SafeHtml>;
}

const sections = new Map<string, ManagementSection>();

/** Registers a section; replaces any section with the same id. */
export function registerManagementSection(section: ManagementSection): void {
  sections.set(section.id, section);
}

/** Removes a section (mainly for tests). */
export function unregisterManagementSection(id: string): void {
  sections.delete(id);
}

/** Registered sections ordered by `order` (then id). */
export function listManagementSections(): ManagementSection[] {
  return [...sections.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
}

/**
 * Renders the management page of `ctx.event`. Ownership must already have been checked with `loadOwnedEvent`.
 * Feature POST routes re-render it with `state[sectionId] = <result>` and a suitable status code.
 */
export async function renderManagementPage(reply: FastifyReply, ctx: ManagementContext, statusCode = 200): Promise<void> {
  const { event } = ctx;
  const rendered: SafeHtml[] = [];
  for (const section of listManagementSections()) {
    const content = await section.render(ctx);
    rendered.push(
      html`<section id="section-${section.id}"><h2>${section.title}</h2>
${content instanceof SafeHtml ? content : raw(content)}
</section>`,
    );
  }
  const body = html`<h1>${event.name}</h1>
<dl class="event-summary">
<dt>Status</dt><dd data-field="status">${EVENT_STATUS_LABELS[event.status]}</dd>
<dt>Data</dt><dd data-field="startsAt">${formatDateTime(event.startsAt)}</dd>
<dt>Local</dt><dd data-field="venue">${event.venue}</dd>
<dt>Lotação</dt><dd data-field="capacity">${event.capacity}</dd>
<dt>Preço</dt><dd data-field="price">${formatBRL(event.priceCents)}</dd>
</dl>
${event.status === 'published' ? html`<p><a href="/events/${event.id}">Ver na vitrine</a></p>` : ''}
<p><a href="/organizer">Voltar para a área do organizador</a></p>
${rendered}`;
  await reply
    .code(statusCode)
    .type('text/html; charset=utf-8')
    .send(layout({ title: event.name, user: ctx.user, body }));
}

/** Form values pre-filled from an event. */
export function eventToFormValues(event: EventRow): EventFormValues {
  return {
    name: event.name,
    startsAt: toDateTimeLocal(event.startsAt),
    venue: event.venue,
    capacity: String(event.capacity),
    price: formatPriceInput(event.priceCents),
  };
}

/** Error list (escaped). */
export function renderErrors(errors: readonly string[] | undefined): SafeHtml {
  if (!errors?.length) return html``;
  return html`<div class="error" role="alert">${errors.map((e) => html`<p>${e}</p>`)}</div>`;
}

/** The event fields shared by the create and edit forms. */
export function renderEventFields(v: EventFormValues): SafeHtml {
  return html`<label>Nome <input name="name" value="${v.name}" required></label>
<label>Data e hora de início <input name="startsAt" type="datetime-local" value="${v.startsAt}" required></label>
<label>Local <input name="venue" value="${v.venue}" required></label>
<label>Lotação <input name="capacity" type="number" min="1" step="1" value="${v.capacity}" required></label>
<label>Preço (R$) <input name="price" inputmode="decimal" placeholder="100,00" value="${v.price}" required></label>`;
}

/** Result of the edit/publish POST routes, kept in `state.edit`. */
export interface EditSectionState {
  errors: string[];
  values?: EventFormValues;
}

/** F02's own section: edit form + `Publicar` (drafts); cancelled events show only `Evento cancelado`. */
export const editSection: ManagementSection = {
  id: 'edit',
  title: 'Editar evento',
  order: 50,
  render({ event, state }) {
    const st = state.edit as EditSectionState | undefined;
    if (event.status === 'cancelled') {
      return html`${renderErrors(st?.errors)}<p class="cancelled">Evento cancelado</p>`;
    }
    const values = st?.values ?? eventToFormValues(event);
    return html`${renderErrors(st?.errors)}
<form method="post" action="/organizer/events/${event.id}" id="edit-event">
${renderEventFields(values)}
<button type="submit">Salvar alterações</button>
</form>
${
  event.status === 'draft'
    ? html`<form method="post" action="/organizer/events/${event.id}/publish" id="publish-event">
<p>Este evento é um rascunho e não aparece na vitrine.</p>
<button type="submit">Publicar</button>
</form>`
    : ''
}`;
  },
};

registerManagementSection(editSection);
