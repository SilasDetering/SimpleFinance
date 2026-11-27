import { normalize } from './categorize';
import { categoryTypeOf, effectiveCategoryId, incomeExpense, type CategoryLookup, type LedgerEntry } from './cash';
import { addMonths, monthKey } from './dates';

/** Auswertungen. Alle Funktionen sind rein und arbeiten auf LedgerEntry (Buchungen). */

export type Period = { kind: 'month'; month: string } | { kind: 'all' };

export function inPeriod(entry: LedgerEntry, period: Period): boolean {
  return period.kind === 'all' || monthKey(entry.bookingDate) === period.month;
}

/** Buchungen nach Monatsschlüssel ("YYYY-MM") gruppiert, Reihenfolge innerhalb des Monats bleibt erhalten. */
export function groupByMonth<T extends LedgerEntry>(entries: T[]): Map<string, T[]> {
  const byMonth = new Map<string, T[]>();
  for (const e of entries) {
    const k = monthKey(e.bookingDate);
    const list = byMonth.get(k);
    if (list) list.push(e);
    else byMonth.set(k, [e]);
  }
  return byMonth;
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
  const byMonth = groupByMonth(entries);
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

  // Einmal nach Monat gruppieren statt für jeden Monat alle Buchungen erneut zu filtern
  const byMonth = groupByMonth(entries);
  const current = new Map(expensesByCategory(byMonth.get(month) ?? [], lookup).map((c) => [c.categoryId, c.cents]));
  const totals = new Map<string, number>();
  for (const m of previous) {
    for (const c of expensesByCategory(byMonth.get(m) ?? [], lookup)) {
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
  entries: (LedgerEntry & { counterparty: string; alias?: string | null })[],
  lookup: CategoryLookup,
  limit = 5,
): TopCounterparty[] {
  const groups = new Map<string, TopCounterparty>();
  for (const e of entries) {
    if (categoryTypeOf(e, lookup) !== 'expense') continue;
    const name = (e.alias || e.counterparty).trim() || 'Ohne Empfänger';
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

/**
 * Die Einzelposten, die in der Auswertung zu einer Ausgabe-Kategorie zählen
 * (gleiche Logik wie expensesByCategory: ohne Kategorie = Sonstiges, inkl. Bar-Ausgaben).
 */
export function entriesForCategory<T extends LedgerEntry>(
  entries: T[],
  lookup: CategoryLookup,
  categoryId: string,
  period: Period,
): T[] {
  return entries.filter(
    (e) => inPeriod(e, period) && categoryTypeOf(e, lookup) !== 'transfer' && effectiveCategoryId(e) === categoryId,
  );
}

export interface CategoryMonth {
  month: string;
  /** Ausgaben (bzw. bei Einnahme-Kategorien Einnahmen) als positive Zahl; Erstattungen verringern sie */
  cents: number;
}

/**
 * Monatsverlauf einer Kategorie: so viele Monate wie Daten vorhanden, höchstens `maxMonths`,
 * bis einschließlich des letzten Monats mit Buchungen. Monate ohne Buchung in der Kategorie zählen als 0.
 */
export function categoryMonthlySeries(
  entries: LedgerEntry[],
  lookup: CategoryLookup,
  categoryId: string,
  maxMonths = 12,
): CategoryMonth[] {
  const months = monthsWithData(entries);
  if (months.length === 0) return [];
  const first = months[0];
  const last = months[months.length - 1];
  const isIncome = lookup.get(categoryId)?.type === 'income';
  const sums = new Map<string, number>();
  for (const e of entriesForCategory(entries, lookup, categoryId, { kind: 'all' })) {
    const k = monthKey(e.bookingDate);
    sums.set(k, (sums.get(k) ?? 0) + (isIncome ? e.amountCents : -e.amountCents));
  }
  const result: CategoryMonth[] = [];
  for (let i = maxMonths - 1; i >= 0; i--) {
    const month = addMonths(last, -i);
    if (month < first) continue;
    result.push({ month, cents: sums.get(month) ?? 0 });
  }
  return result;
}

/** Alle Einnahmen (Buchungen in Einnahme-Kategorien) im Zeitraum, ohne Umbuchungen. */
export function incomeEntries<T extends LedgerEntry>(entries: T[], lookup: CategoryLookup, period: Period): T[] {
  return entries.filter((e) => inPeriod(e, period) && categoryTypeOf(e, lookup) === 'income');
}

/**
 * Monatsverlauf der Einnahmen: so viele Monate wie Daten vorhanden, höchstens `maxMonths`,
 * bis einschließlich des letzten Monats mit Buchungen. Monate ohne Einnahmen zählen als 0.
 */
export function incomeMonthlySeries(entries: LedgerEntry[], lookup: CategoryLookup, maxMonths = 12): CategoryMonth[] {
  const months = monthsWithData(entries);
  if (months.length === 0) return [];
  const first = months[0];
  const last = months[months.length - 1];
  const byMonth = groupByMonth(entries);
  const result: CategoryMonth[] = [];
  for (let i = maxMonths - 1; i >= 0; i--) {
    const month = addMonths(last, -i);
    if (month < first) continue;
    result.push({ month, cents: incomeExpense(byMonth.get(month) ?? [], lookup).incomeCents });
  }
  return result;
}
