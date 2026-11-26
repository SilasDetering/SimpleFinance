import { toLookup, type LedgerEntry } from '../cash';
import { DEFAULT_CATEGORIES } from '../defaults';
import {
  EMPTY_FILTER,
  UNCATEGORIZED,
  activeFilterCount,
  filterTransactions,
  monthEndBalances,
  resolvePeriod,
  type TransactionFilter,
} from '../filter';
import { ACCOUNT_CASH, ACCOUNT_GIRO } from '../types';

const lookup = toLookup(DEFAULT_CATEGORIES);
const e = (id: string, bookingDate: string, amountCents: number, categoryId: string | null, accountId = ACCOUNT_GIRO) => ({
  id,
  bookingDate,
  amountCents,
  categoryId,
  accountId,
});
const entries: (LedgerEntry & { id: string })[] = [
  e('salary', '2026-11-25', 285000, 'income'),
  e('rewe', '2026-11-03', -4200, 'groceries'),
  e('refund', '2026-11-21', 4995, 'shopping'),
  e('atm', '2026-11-08', -10000, 'cash'),
  e('saving', '2026-11-18', -20000, 'transfer'),
  e('baker', '2026-10-30', -800, 'groceries', ACCOUNT_CASH),
  e('unknown', '2026-09-27', -1750, null),
  e('old', '2025-12-10', -999, 'shopping'),
];
const ids = (f: Partial<TransactionFilter>, month = '2026-11') =>
  filterTransactions(entries, { ...EMPTY_FILTER, ...f }, lookup, month).map((x) => x.id);

describe('Filter im Verlauf', () => {
  it('ohne Filter alles', () => {
    expect(ids({})).toHaveLength(entries.length);
  });

  it('Einnahmen: Gutschriften ohne Umbuchungen', () => {
    expect(ids({ kind: 'income' })).toEqual(['salary', 'refund']);
  });

  it('Ausgaben: Abbuchungen inkl. Bar-Ausgaben, ohne Abhebungen und Sparen', () => {
    expect(ids({ kind: 'expense' })).toEqual(['rewe', 'baker', 'unknown', 'old']);
  });

  it('Kategorie, mehrere Kategorien und "ohne Kategorie"', () => {
    expect(ids({ categoryIds: ['groceries'] })).toEqual(['rewe', 'baker']);
    expect(ids({ categoryIds: ['groceries', UNCATEGORIZED] })).toEqual(['rewe', 'baker', 'unknown']);
  });

  it('Zeitraum-Presets', () => {
    expect(ids({ preset: 'thisMonth' })).toEqual(['salary', 'rewe', 'refund', 'atm', 'saving']);
    expect(ids({ preset: 'lastMonth' })).toEqual(['baker']);
    expect(ids({ preset: 'last3' })).toEqual(['salary', 'rewe', 'refund', 'atm', 'saving', 'baker', 'unknown']);
    expect(ids({ preset: 'thisYear' })).not.toContain('old');
  });

  it('eigener Zeitraum (auch vertauscht)', () => {
    expect(ids({ preset: 'custom', fromMonth: '2026-09', toMonth: '2026-10' })).toEqual(['baker', 'unknown']);
    expect(resolvePeriod({ ...EMPTY_FILTER, preset: 'custom', fromMonth: '2026-10', toMonth: '2026-09' }, '2026-11')).toEqual({
      from: '2026-09',
      to: '2026-10',
    });
  });

  it('Filter kombinieren', () => {
    expect(ids({ kind: 'expense', categoryIds: ['shopping'], preset: 'thisYear' })).toEqual([]);
    expect(ids({ kind: 'income', categoryIds: ['shopping'] })).toEqual(['refund']);
    expect(activeFilterCount({ kind: 'income', categoryIds: ['shopping'], preset: 'all' })).toBe(2);
  });
});

describe('monthEndBalances', () => {
  it('nimmt den Saldo der letzten Bank-Buchung je Monat', () => {
    const m = monthEndBalances(
      [
        { accountId: ACCOUNT_GIRO, bookingDate: '2026-10-30', balanceCents: 1000, dayOrder: 0 },
        { accountId: ACCOUNT_GIRO, bookingDate: '2026-10-30', balanceCents: 900, dayOrder: 1 },
        { accountId: ACCOUNT_GIRO, bookingDate: '2026-10-02', balanceCents: 5000, dayOrder: 5 },
        { accountId: ACCOUNT_CASH, bookingDate: '2026-10-31', balanceCents: null, dayOrder: 0 },
        { accountId: ACCOUNT_GIRO, bookingDate: '2026-11-03', balanceCents: 700, dayOrder: 0 },
      ],
      ACCOUNT_GIRO,
    );
    expect(m.get('2026-10')).toBe(900);
    expect(m.get('2026-11')).toBe(700);
  });
});
