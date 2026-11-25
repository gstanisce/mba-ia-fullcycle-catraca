import type { SafeHtml } from '../../lib/html.js';
import type { SessionUser } from '../../lib/layout.js';
import type { EventRow } from './repo.js';

export interface PurchaseSlotContext {
  event: EventRow;
  user: SessionUser | null;
  /** `availableSeats` of the event (R05). */
  available: number;
  /** Optional message shown by the slot (e.g. `Ingressos esgotados` after a failed purchase). */
  message?: string;
}

/** Renders the purchase area of the public event page. A returned string is emitted as-is (trusted HTML). */
export type PurchaseSlotRenderer = (ctx: PurchaseSlotContext) => string | SafeHtml;

let slot: PurchaseSlotRenderer | null = null;

/** Registers (or replaces) the purchase slot. F03 owns it. */
export function setPurchaseSlot(fn: PurchaseSlotRenderer | null): void {
  slot = fn;
}

/** Renders the registered slot; '' when none is registered. */
export function renderPurchaseSlot(ctx: PurchaseSlotContext): string {
  return slot ? slot(ctx).toString() : '';
}
