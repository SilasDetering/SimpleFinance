import { toLookup, type LedgerEntry } from '../cash';
import { DEFAULT_CATEGORIES } from '../defaults';
import { detectRecurring, recurringTotal } from '../recurring';
import {
  categoryMonthlySeries,
  balanceSeries,
  entriesForCategory,
  categoryVsAverage,
  expensesByCategory,
  monthlySeries,
  savingsRate,
  topCounterparties,
} from '../stats';
import { ACCOUNT_CASH, ACCOUNT_GIRO } from '../types';

const lookup = toLookup(DEFAULT_CATEGORIES);
type E = LedgerEntry & { counterparty: string };
const e = (bookingDate: string, amountCents: number, categoryId: string | null, counterparty = 'X', accountId = ACCOUNT_GIRO): E => ({
  bookingDate,
  amountCents,
  categoryId,
  counterparty,
  accountId,
});

describe('expensesByCategory', () => {
  it('summiert Ausgaben inkl. Bar-Ausgaben, ohne Umbuchungen und Bargeld', () => {
    const r = expensesByCategory(
      [
        e('2026-11-01', -3000, 'groceries'),
        e('2026-11-02', -800, 'groceries', 'Bäcker', ACCOUNT_CASH),
        e('2026-11-03', -1000, 'restaurant'),
        e('2026-11-04', -10000, 'cash'),
        e('2026-11-05', -20000, 'transfer'),
        e('2026-11-25', 285000, 'income'),
      ],
      lookup,
    );
    expect(r.map((x) => x.categoryId)).toEqual(['groceries', 'restaurant']);
    expect(r[0].cents).toBe(3800);
    expect(r[0].share).toBeCloseTo(3800 / 4800);
  });
});

describe('monthlySeries & savingsRate', () => {
  it('liefert lückenlose Monate', () => {
    const s = monthlySeries([e('2026-09-10', -500, 'groceries'), e('2026-11-25', 1000, 'income')], lookup, '2026-11', 3);
    expect(s).toEqual([
      { month: '2026-09', incomeCents: 0, expenseCents: 500 },
      { month: '2026-10', incomeCents: 0, expenseCents: 0 },
      { month: '2026-11', incomeCents: 1000, expenseCents: 0 },
    ]);
  });

  it('Sparquote', () => {
    expect(savingsRate(200000, 150000)).toBeCloseTo(0.25);
    expect(savingsRate(0, 100)).toBeNull();
  });
});

describe('categoryVsAverage', () => {
  it('erkennt Abweichung zum eigenen Durchschnitt', () => {
    const entries = [
      e('2026-08-10', -10000, 'restaurant'),
      e('2026-09-10', -10000, 'restaurant'),
      e('2026-10-10', -10000, 'restaurant'),
      e('2026-11-10', -13500, 'restaurant'),
      e('2026-08-10', -5000, 'groceries'),
      e('2026-11-10', -5100, 'groceries'), // kleine Abweichung -> nicht gemeldet
    ];
    const r = categoryVsAverage(entries, lookup, '2026-11');
    const rest = r.find((x) => x.categoryId === 'restaurant')!;
    expect(rest.averageCents).toBe(10000);
    expect(rest.deviation).toBeCloseTo(0.35);
  });

  it('ohne Vormonate keine Aussage', () => {
    expect(categoryVsAverage([e('2026-11-10', -100, 'groceries')], lookup, '2026-11')).toEqual([]);
  });
});

describe('topCounterparties', () => {
  it('gruppiert case-insensitive und sortiert nach Summe', () => {
    const r = topCounterparties(
      [e('2026-11-01', -3000, 'groceries', 'REWE'), e('2026-11-02', -2000, 'groceries', 'rewe'), e('2026-11-03', -4000, 'shopping', 'Amazon')],
      lookup,
    );
    expect(r[0]).toMatchObject({ cents: 5000, count: 2 });
    expect(r[1].name).toBe('Amazon');
  });
});

describe('detectRecurring', () => {
  const months = ['2026-08', '2026-09', '2026-10', '2026-11'];
  it('findet monatliche Abos mit stabilem Betrag', () => {
    const entries = months.flatMap((m) => [
      e(`${m}-02`, -1199, 'subscriptions', 'Spotify AB'),
      e(`${m}-01`, -85000, 'housing', 'Hausverwaltung'),
      e(`${m}-03`, -Math.round(2000 + Math.random() * 6000), 'groceries', 'REWE'),
      e(`${m}-17`, -Math.round(2000 + Math.random() * 6000), 'groceries', 'REWE'),
    ]);
    const r = detectRecurring(entries, lookup);
    expect(r.map((x) => x.name)).toEqual(['Hausverwaltung', 'Spotify AB']);
    expect(recurringTotal(r)).toBe(86199);
  });

  it('ignoriert beendete Abos und schwankende Beträge', () => {
    const entries = [
      ...['2026-05', '2026-06', '2026-07'].map((m) => e(`${m}-04`, -1399, 'subscriptions', 'Netflix')),
      ...months.map((m, i) => e(`${m}-10`, -(2000 + i * 1500), 'restaurant', 'Lieferando')),
      e('2026-11-20', -100, 'groceries', 'Anker'),
    ];
    expect(detectRecurring(entries, lookup)).toEqual([]);
  });
});

describe('balanceSeries', () => {
  it('nimmt den letzten Saldo je Tag', () => {
    const r = balanceSeries([
      { bookingDate: '2026-11-01', balanceCents: 1000, dayOrder: 0 },
      { bookingDate: '2026-11-01', balanceCents: 800, dayOrder: 1 },
      { bookingDate: '2026-11-02', balanceCents: 500, dayOrder: 0 },
      { bookingDate: '2026-11-02', balanceCents: null, dayOrder: 1 },
    ]);
    expect(r).toEqual([
      { date: '2026-11-01', cents: 800 },
      { date: '2026-11-02', cents: 500 },
    ]);
  });
});

describe('entriesForCategory', () => {
  it('liefert die Posten, die in die Kategorie-Summe einfließen', () => {
    const entries = [
      e('2026-11-01', -3000, 'groceries'),
      e('2026-11-02', -800, 'groceries', 'Bäcker', ACCOUNT_CASH),
      e('2026-10-02', -500, 'groceries'),
      e('2026-11-03', -1750, null),
      e('2026-11-04', -10000, 'cash'),
    ];
    const month = { kind: 'month' as const, month: '2026-11' };
    const groceries = entriesForCategory(entries, lookup, 'groceries', month);
    expect(groceries).toHaveLength(2);
    expect(-groceries.reduce((s, x) => s + x.amountCents, 0)).toBe(
      expensesByCategory(entries.filter((x) => x.bookingDate.startsWith('2026-11')), lookup).find((c) => c.categoryId === 'groceries')!.cents,
    );
    expect(entriesForCategory(entries, lookup, 'other', month)).toHaveLength(1);
    expect(entriesForCategory(entries, lookup, 'groceries', { kind: 'all' })).toHaveLength(3);
  });
});

describe('categoryMonthlySeries', () => {
  it('zeigt alle Monate mit Daten, Lücken als 0, Erstattungen verrechnet', () => {
    const entries = [
      e('2026-08-03', -5000, 'groceries'),
      e('2026-08-20', 1000, 'groceries'), // Erstattung
      e('2026-09-10', -2000, 'leisure'),
      e('2026-10-05', -3000, 'groceries'),
      e('2026-10-06', -100000, 'cash'), // Abhebung zählt nicht
    ];
    expect(categoryMonthlySeries(entries, lookup, 'groceries')).toEqual([
      { month: '2026-08', cents: 4000 },
      { month: '2026-09', cents: 0 },
      { month: '2026-10', cents: 3000 },
    ]);
  });

  it('begrenzt auf die letzten 12 Monate', () => {
    const entries = Array.from({ length: 18 }, (_, i) => {
      const y = 2025 + Math.floor(i / 12);
      const m = String((i % 12) + 1).padStart(2, '0');
      return e(`${y}-${m}-15`, -1000 * (i + 1), 'groceries');
    });
    const s = categoryMonthlySeries(entries, lookup, 'groceries');
    expect(s).toHaveLength(12);
    expect(s[0]).toEqual({ month: '2025-07', cents: 7000 });
    expect(s[11]).toEqual({ month: '2026-06', cents: 18000 });
  });

  it('Einnahme-Kategorien zählen positiv', () => {
    expect(categoryMonthlySeries([e('2026-10-01', 250000, 'income')], lookup, 'income')).toEqual([
      { month: '2026-10', cents: 250000 },
    ]);
  });
});
