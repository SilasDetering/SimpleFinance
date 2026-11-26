import { formatCents, formatPercent, parseGermanAmount } from '../money';
import { addMonths, formatMonth, parseGermanDate } from '../dates';

describe('parseGermanAmount', () => {
  it.each([
    ['1.234,56', 123456],
    ['-12,99', -1299],
    ['+5,00', 500],
    ['0,01', 1],
    ['12,5', 1250],
    ['1.000.000,00', 100000000],
    ['  -1.234,56 € ', -123456],
    ['12', 1200],
    ['1.234', 123400],
    ['12,99-', -1299],
  ])('%s -> %d', (input, expected) => {
    expect(parseGermanAmount(input)).toBe(expected);
  });

  it.each(['', 'abc', '1,2,3', '--5'])('ungültig: %s', (input) => {
    expect(parseGermanAmount(input)).toBeNull();
  });
});

describe('formatCents', () => {
  it('formatiert im deutschen Format', () => {
    expect(formatCents(123456)).toBe('1.234,56 €');
    expect(formatCents(-1299)).toBe('−12,99 €');
    expect(formatCents(5)).toBe('0,05 €');
    expect(formatCents(100000000)).toBe('1.000.000,00 €');
    expect(formatCents(500, { sign: true })).toBe('+5,00 €');
  });

  it('formatPercent', () => {
    expect(formatPercent(0.354)).toBe('35 %');
  });
});

describe('dates', () => {
  it('parseGermanDate', () => {
    expect(parseGermanDate('26.11.2026')).toBe('2026-11-26');
    expect(parseGermanDate('1.2.26')).toBe('2026-02-01');
    expect(parseGermanDate('31.02.2026')).toBeNull();
    expect(parseGermanDate('2026-11-26')).toBeNull();
  });

  it('addMonths / formatMonth', () => {
    expect(addMonths('2026-11', 2)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(formatMonth('2026-03')).toBe('März 2026');
  });
});
