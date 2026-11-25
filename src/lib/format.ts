import { config } from '../config.js';

/** Fixed display/input offset (Brazil, no DST), e.g. '-03:00' → -180 minutes. */
const OFFSET = config.tzOffset;
const OFFSET_MINUTES = (() => {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(OFFSET);
  if (!m) throw new Error(`invalid tzOffset: ${OFFSET}`);
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
})();

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

/** Wall-clock parts of `date` in the configured offset. */
function localParts(date: Date) {
  const d = new Date(date.getTime() + OFFSET_MINUTES * 60_000);
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    second: d.getUTCSeconds(),
  };
}

/** Cents → `R$ 1.234,56` (negative: `-R$ 1,00`). */
export function formatBRL(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  const reais = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${sign}R$ ${reais},${pad(abs % 100)}`;
}

/** Cents → value for a price input, e.g. 123456 → `1234,56`. */
export function formatPriceInput(cents: number): string {
  return `${Math.floor(cents / 100)},${pad(cents % 100)}`;
}

/** `05/12/2026 21:00` in the configured offset. */
export function formatDateTime(date: Date): string {
  const p = localParts(date);
  return `${pad(p.day)}/${pad(p.month)}/${p.year} ${pad(p.hour)}:${pad(p.minute)}`;
}

/** ISO 8601 with offset, e.g. `2026-12-05T21:00:00-03:00`. */
export function toIsoWithOffset(date: Date): string {
  const p = localParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}${OFFSET}`;
}

/** Value for `<input type="datetime-local">`, e.g. `2026-12-05T21:00`. */
export function toDateTimeLocal(date: Date): string {
  const p = localParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * Parses a `datetime-local` value (`2026-12-05T21:00`, optional `:SS`) as wall-clock time in the configured offset.
 * Returns null for malformed or non-existent dates (e.g. 2026-02-30).
 */
export function parseDateTimeLocal(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s = '00'] = m;
  const date = new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${OFFSET}`);
  if (Number.isNaN(date.getTime())) return null;
  const p = localParts(date);
  // Reject values the Date constructor silently normalized (31/04, 30/02, 24:00…).
  if (p.year !== Number(y) || p.month !== Number(mo) || p.day !== Number(d) || p.hour !== Number(h) || p.minute !== Number(mi)) {
    return null;
  }
  return date;
}
