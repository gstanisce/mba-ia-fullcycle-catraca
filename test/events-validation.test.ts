import { describe, expect, it } from 'vitest';
import {
  MSG_CAPACITY_INVALID,
  MSG_NAME_REQUIRED,
  MSG_PRICE_INVALID,
  MSG_STARTS_AT_INVALID,
  MSG_STARTS_AT_PAST,
  MSG_VENUE_REQUIRED,
  parsePriceCents,
  readEventForm,
  validateEventForm,
  type EventFormValues,
} from '../src/features/events/validation.js';

const NOW = new Date('2026-11-25T12:00:00-03:00');
const valid: EventFormValues = { name: ' Show ', startsAt: '2026-12-05T21:00', venue: ' Bar ', capacity: '2', price: '100,00' };

describe('parsePriceCents (price in reais)', () => {
  it.each([
    ['100', 10000],
    ['100,00', 10000],
    ['100.00', 10000],
    ['1.234,56', 123456],
    ['1234,56', 123456],
    ['0,5', 50],
    [' 99,90 ', 9990],
    ['R$ 100,00', 10000],
    ['1.234', 123400],
    ['0', 0],
  ])('%j → %i', (input, cents) => {
    expect(parsePriceCents(input)).toBe(cents);
  });

  it.each(['', 'abc', '-10', '10,999', '1,234.56', '1.23.4', '10e3', '1 000'])('%j is malformed', (input) => {
    expect(parsePriceCents(input)).toBeNull();
  });
});

describe('validateEventForm (R01)', () => {
  it('accepts a valid form and normalizes it', () => {
    const r = validateEventForm(valid, NOW);
    expect(r).toEqual({
      ok: true,
      value: { name: 'Show', venue: 'Bar', startsAt: new Date('2026-12-06T00:00:00Z'), capacity: 2, priceCents: 10000 },
    });
  });

  it.each([
    ['capacity 0', { capacity: '0' }, MSG_CAPACITY_INVALID],
    ['capacity negative', { capacity: '-1' }, MSG_CAPACITY_INVALID],
    ['capacity decimal', { capacity: '1.5' }, MSG_CAPACITY_INVALID],
    ['capacity empty', { capacity: '' }, MSG_CAPACITY_INVALID],
    ['capacity huge', { capacity: '99999999999' }, MSG_CAPACITY_INVALID],
    ['price 0', { price: '0' }, MSG_PRICE_INVALID],
    ['price 0,00', { price: '0,00' }, MSG_PRICE_INVALID],
    ['price negative', { price: '-1' }, MSG_PRICE_INVALID],
    ['price text', { price: 'grátis' }, MSG_PRICE_INVALID],
    ['empty name', { name: '   ' }, MSG_NAME_REQUIRED],
    ['empty venue', { venue: '' }, MSG_VENUE_REQUIRED],
    ['malformed date', { startsAt: 'amanhã' }, MSG_STARTS_AT_INVALID],
    ['past date', { startsAt: '2026-11-24T10:00' }, MSG_STARTS_AT_PAST],
    ['now is not future', { startsAt: '2026-11-25T12:00' }, MSG_STARTS_AT_PAST],
  ])('rejects %s', (_label, patch, message) => {
    const r = validateEventForm({ ...valid, ...patch }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toEqual([message]);
  });

  it('reports every invalid field at once', () => {
    const r = validateEventForm({ name: '', startsAt: '', venue: '', capacity: '0', price: '0' }, NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toHaveLength(5);
  });

  it('readEventForm returns "" for missing or non-string fields', () => {
    expect(readEventForm({ name: 'X', capacity: ['1', '2'] })).toEqual({
      name: 'X',
      startsAt: '',
      venue: '',
      capacity: '',
      price: '',
    });
    expect(readEventForm(undefined).name).toBe('');
  });
});
