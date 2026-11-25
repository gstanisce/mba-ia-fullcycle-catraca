import type { FastifyInstance } from 'fastify';
import { formatBRL } from '../../lib/format.js';
import { html } from '../../lib/html.js';
import { registerManagementSection, type ManagementSection } from '../events/management.js';
import { getDashboard } from './service.js';

/** Exact labels of the brief (R12). */
export const PANEL_LABELS = {
  confirmed: 'Confirmados',
  pending: 'Pendentes',
  checkins: 'Check-ins',
  available: 'Vagas disponíveis',
  revenue: 'Receita',
  refunded: 'Estornados',
} as const;

/**
 * F07 section `Painel` (order 10) of the management page. Ownership is already enforced by the page
 * (`loadOwnedEvent`), so only the event owner ever sees it.
 */
export const panelSection: ManagementSection = {
  id: 'panel',
  title: 'Painel',
  order: 10,
  async render({ event, db }) {
    const d = await getDashboard(db, event);
    const values: Record<keyof typeof PANEL_LABELS, string> = {
      confirmed: String(d.confirmed),
      pending: String(d.pending),
      checkins: String(d.checkins),
      available: String(d.available),
      revenue: formatBRL(d.revenueCents),
      refunded: String(d.refunded),
    };
    const items = (Object.keys(PANEL_LABELS) as (keyof typeof PANEL_LABELS)[]).map(
      (k) => html`<dt>${PANEL_LABELS[k]}</dt><dd data-metric="${k}">${values[k]}</dd>`,
    );
    return html`<dl id="panel">
${items}
</dl>`;
  },
};

/** F07: registers the `Painel` section of the event management page. */
export function registerDashboard(_app: FastifyInstance): void {
  registerManagementSection(panelSection);
}
