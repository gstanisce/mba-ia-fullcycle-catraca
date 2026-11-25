import { parseDateTimeLocal } from '../../lib/format.js';

/** Validated event fields, shared by create and edit. */
export interface EventInput {
  name: string;
  venue: string;
  startsAt: Date;
  capacity: number;
  priceCents: number;
}

/** Raw form values (as typed), echoed back in the form on errors. */
export interface EventFormValues {
  name: string;
  startsAt: string;
  venue: string;
  capacity: string;
  price: string;
}

export type ValidationResult = { ok: true; value: EventInput } | { ok: false; errors: string[] };

export const MSG_NAME_REQUIRED = 'Informe o nome do evento';
export const MSG_VENUE_REQUIRED = 'Informe o local do evento';
export const MSG_STARTS_AT_INVALID = 'Informe a data e hora de início (ex.: 2026-12-05T21:00)';
export const MSG_STARTS_AT_PAST = 'A data de início precisa estar no futuro';
export const MSG_CAPACITY_INVALID = 'A lotação deve ser um número inteiro maior ou igual a 1';
export const MSG_PRICE_INVALID = 'O preço deve ser maior que zero, em reais (ex.: 100,00)';

const MAX_INT = 2_147_483_647; // Postgres int

/** Reads the event fields from a form body ('' for missing/non-string). */
export function readEventForm(body: unknown): EventFormValues {
  const get = (name: string): string => {
    if (body && typeof body === 'object' && name in body) {
      const v = (body as Record<string, unknown>)[name];
      if (typeof v === 'string') return v;
    }
    return '';
  };
  return { name: get('name'), startsAt: get('startsAt'), venue: get('venue'), capacity: get('capacity'), price: get('price') };
}

/**
 * Price in reais → integer cents. Accepts `100`, `100,00`, `100.00`, `1.234,56`, `1234,5`.
 * Returns null when malformed. (Does not check > 0.)
 */
export function parsePriceCents(input: string): number | null {
  const s = input.trim().replace(/^R\$\s*/, '');
  let intPart: string;
  let decPart = '';
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(s))) {
    intPart = m[1]!.replace(/\./g, '');
    decPart = m[2] ?? '';
  } else if ((m = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(s))) {
    intPart = m[1]!;
    decPart = m[2] ?? '';
  } else {
    return null;
  }
  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Validates create/edit fields. `now` is injectable for tests. */
export function validateEventForm(values: EventFormValues, now: Date = new Date()): ValidationResult {
  const errors: string[] = [];
  const name = values.name.trim();
  const venue = values.venue.trim();
  if (!name) errors.push(MSG_NAME_REQUIRED);

  const startsAt = parseDateTimeLocal(values.startsAt);
  if (!startsAt) errors.push(MSG_STARTS_AT_INVALID);
  else if (startsAt.getTime() <= now.getTime()) errors.push(MSG_STARTS_AT_PAST);

  if (!venue) errors.push(MSG_VENUE_REQUIRED);

  const capText = values.capacity.trim();
  const capacity = /^\d+$/.test(capText) ? Number(capText) : NaN;
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_INT) errors.push(MSG_CAPACITY_INVALID);

  const priceCents = parsePriceCents(values.price);
  if (priceCents === null || priceCents <= 0 || priceCents > MAX_INT) errors.push(MSG_PRICE_INVALID);

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { name, venue, startsAt: startsAt!, capacity, priceCents: priceCents! } };
}
