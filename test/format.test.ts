import { describe, expect, it } from 'vitest';
import {
  formatBRL,
  formatDateTime,
  formatPriceInput,
  parseDateTimeLocal,
  toDateTimeLocal,
  toIsoWithOffset,
} from '../src/lib/format.js';

describe('formatBRL', () => {
  it.each([
    [0, 'R$ 0,00'],
    [5, 'R$ 0,05'],
    [10000, 'R$ 100,00'],
    [35000, 'R$ 350,00'],
    [123456, 'R$ 1.234,56'],
    [123456789, 'R$ 1.234.567,89'],
    [-100, '-R$ 1,00'],
  ])('%i → %s', (cents, expected) => {
    expect(formatBRL(cents)).toBe(expected);
  });

  it('formatPriceInput gives the value used in the edit form', () => {
    expect(formatPriceInput(10000)).toBe('100,00');
    expect(formatPriceInput(123456)).toBe('1234,56');
    expect(formatPriceInput(5)).toBe('0,05');
  });
});

describe('dates in -03:00', () => {
  const d = new Date('2026-12-06T00:00:00Z'); // 05/12/2026 21:00 in -03:00

  it('formatDateTime', () => {
    expect(formatDateTime(d)).toBe('05/12/2026 21:00');
  });

  it('toIsoWithOffset', () => {
    expect(toIsoWithOffset(d)).toBe('2026-12-05T21:00:00-03:00');
    expect(new Date(toIsoWithOffset(d)).getTime()).toBe(d.getTime());
  });

  it('toDateTimeLocal', () => {
    expect(toDateTimeLocal(d)).toBe('2026-12-05T21:00');
  });

  it('parseDateTimeLocal interprets the value in -03:00 and round-trips', () => {
    expect(parseDateTimeLocal('2026-12-05T21:00')?.toISOString()).toBe('2026-12-06T00:00:00.000Z');
    expect(parseDateTimeLocal('2026-12-05T21:00:30')?.toISOString()).toBe('2026-12-06T00:00:30.000Z');
    expect(toDateTimeLocal(parseDateTimeLocal('2027-01-01T00:05')!)).toBe('2027-01-01T00:05');
  });

  it.each(['', 'amanhã', '2026-12-05', '2026-13-01T10:00', '2026-02-30T10:00', '2026-04-31T10:00', '2026-12-05T24:00', '05/12/2026 21:00'])(
    'parseDateTimeLocal rejects %j',
    (value) => {
      expect(parseDateTimeLocal(value)).toBeNull();
    },
  );
});
