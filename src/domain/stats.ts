import { normalize } from './categorize';
import { categoryTypeOf, effectiveCategoryId, incomeExpense, type CategoryLookup, type LedgerEntry } from './cash';
import { addMonths, monthKey } from './dates';

/** Auswertungen. Alle Funktionen sind rein und arbeiten auf LedgerEntry (Buchungen). */

export type Period = { kind: 'month'; month: string } | { kind: 'all' };

export function inPeriod(entry: LedgerEntry, period: Period): boolean {
  return period.kind === 'all' || monthKey(entry.bookingDate) === period.month;
}

/** Alle Monate mit Buchungen, aufsteigend. */
export function monthsWithData(entries: LedgerEntry[]): string[] {
  return [...new Set(entries.map((e) => monthKey(e.bookingDate)))].sort();
}

export interface CategoryShare {
  categoryId: string;
  cents: number;
  share: number;
}

/** Ausgaben nach Kategorie (nur Ausgabe-Kategorien, nur positive Summen), absteigend. */
export function expensesByCategory(entries: LedgerEntry[], lookup: CategoryLookup): CategoryShare[] {
  const sums = new Map<string, number>();
  for (const e of entries) {
    if (categoryTypeOf(e, lookup) !== 'expense') continue;
    const id = effectiveCategoryId(e);
    sums.set(id, (sums.get(id) ?? 0) - e.amountCents);
  }
  const positive = [...sums.entries()].filter(([, c]) => c > 0);
  const total = positive.reduce((s, [, c]) => s + c, 0);
  return positive
    .map(([categoryId, cents]) => ({ categoryId, cents, share: total ? cents / total : 0 }))
    .sort((a, b) => b.cents - a.cents);
}

export interface MonthBar {
  month: string;
  incomeCents: number;
  expenseCents: number;
}

/** Einnahmen und Ausgaben der letzten `count` Monate bis einschließlich `endMonth`. */
export function monthlySeries(entries: LedgerEntry[], lookup: CategoryLookup, endMonth: string, count: number): MonthBar[] {
  const byMonth = new Map<string, LedgerEntry[]>();
  for (const e of entries) {
    const k = monthKey(e.bookingDate);
    if (!byMonth.has(k)) byMonth.set(k, []);
    byMonth.get(k)!.push(e);
  }
  const result: MonthBar[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const month = addMonths(endMonth, -i);
    const ie = incomeExpense(byMonth.get(month) ?? [], lookup);
    result.push({ month, incomeCents: ie.incomeCents, expenseCents: ie.expenseCents });
  }
  return result;
}

/** Sparquote = (Einnahmen − Ausgaben) / Einnahmen. null, wenn keine Einnahmen. */
export function savingsRate(incomeCents: number, expenseCents: number): number | null {
  if (incomeCents <= 0) return null;
  return (incomeCents - expenseCents) / incomeCents;
}

export interface CategoryDeviation {
  categoryId: string;
  currentCents: number;
  averageCents: number;
  /** relative Abweichung, z. B. 0.35 = +35 % */
  deviation: number;
}

/**
 * Vergleicht die Ausgaben je Kategorie im Monat mit dem eigenen Durchschnitt
 * der bis zu 12 Vormonate (nur Monate mit Daten). Liefert nur nennenswerte Abweichungen
 * für Kategorien mit Ausgaben im gewählten Monat.
 */
export function categoryVsAverage(
  entries: LedgerEntry[],
  lookup: CategoryLookup,
  month: string,
  opts: { minAverageCents?: number; minDeviation?: number; lookbackMonths?: number } = {},
): CategoryDeviation[] {
  const { minAverageCents = 1000, minDeviation = 0.15, lookbackMonths = 12 } = opts;
  const from = addMonths(month, -lookbackMonths);
  const allMonths = monthsWithData(entries);
  const previous = allMonths.filter((m) => m < month && m >= from);
  if (previous.length === 0) return [];

  const current = new Map(expensesByCategory(entries.filter((e) => monthKey(e.bookingDate) === month), lookup).map((c) => [c.categoryId, c.cents]));
  const totals = new Map<string, number>();
  for (const m of previous) {
    for (const c of expensesByCategory(entries.filter((e) => monthKey(e.bookingDate) === m), lookup)) {
      totals.set(c.categoryId, (totals.get(c.categoryId) ?? 0) + c.cents);
    }
  }
  const ids = new Set([...current.keys(), ...totals.keys()]);
  const result: CategoryDeviation[] = [];
  for (const id of ids) {
    const averageCents = Math.round((totals.get(id) ?? 0) / previous.length);
    const currentCents = current.get(id) ?? 0;
    if (averageCents < minAverageCents || currentCents <= 0) continue;
    const deviation = (currentCents - averageCents) / averageCents;
    if (Math.abs(deviation) >= minDeviation) result.push({ categoryId: id, currentCents, averageCents, deviation });
  }
  return result.sort((a, b) => Math.abs(b.deviation) - Math.abs(a.deviation));
}

export interface TopCounterparty {
  name: string;
  cents: number;
  count: number;
}

/** Top-Empfänger nach Ausgaben (ohne Umbuchungen). */
export function topCounterparties(
  entries: (LedgerEntry & { counterparty: string })[],
  lookup: CategoryLookup,
  limit = 5,
): TopCounterparty[] {
  const groups = new Map<string, TopCounterparty>();
  for (const e of entries) {
    if (categoryTypeOf(e, lookup) !== 'expense') continue;
    const name = e.counterparty.trim() || 'Ohne Empfänger';
    const key = normalize(name);
    const g = groups.get(key) ?? { name, cents: 0, count: 0 };
    g.cents -= e.amountCents;
    g.count++;
    groups.set(key, g);
  }
  return [...groups.values()]
    .filter((g) => g.cents > 0)
    .sort((a, b) => b.cents - a.cents)
    .slice(0, limit);
}

export interface BalancePoint {
  date: string;
  cents: number;
}

/** Kontostand-Verlauf aus der Saldo-Spalte: letzter Saldo je Tag, chronologisch. */
export function balanceSeries(
  entries: { bookingDate: string; balanceCents: number | null; dayOrder: number }[],
): BalancePoint[] {
  const byDay = new Map<string, { cents: number; order: number }>();
  for (const e of entries) {
    if (e.balanceCents == null) continue;
    const cur = byDay.get(e.bookingDate);
    if (!cur || e.dayOrder >= cur.order) byDay.set(e.bookingDate, { cents: e.balanceCents, order: e.dayOrder });
  }
  return [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, v]) => ({ date, cents: v.cents }));
}
