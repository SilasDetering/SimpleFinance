import { categoryTypeOf, type CategoryLookup, type LedgerEntry } from './cash';
import { addMonths, monthKey } from './dates';

/**
 * Filter für die Buchungsliste (Verlauf).
 *
 * - kind: 'income' = Gutschriften, 'expense' = Abbuchungen. Umbuchungen (Sparen, Bargeld-Abhebungen
 *   und -Einzahlungen) zählen nach der Bargeld-Logik weder als Einnahme noch als Ausgabe und
 *   erscheinen deshalb nur bei 'all'.
 * - categoryIds: leer = alle; UNCATEGORIZED steht für Buchungen ohne Kategorie.
 * - period: Zeitraum in Monaten (inklusive), null = gesamter Zeitraum.
 */
export type FilterKind = 'all' | 'income' | 'expense';

export const UNCATEGORIZED = '__none__';

export type PeriodPreset = 'all' | 'thisMonth' | 'lastMonth' | 'last3' | 'thisYear' | 'custom';

export interface TransactionFilter {
  kind: FilterKind;
  categoryIds: string[];
  preset: PeriodPreset;
  /** nur bei preset 'custom': Monatsschlüssel "YYYY-MM" (inklusive) */
  fromMonth?: string;
  toMonth?: string;
}

export const EMPTY_FILTER: TransactionFilter = { kind: 'all', categoryIds: [], preset: 'all' };

/** Löst ein Zeitraum-Preset relativ zum aktuellen Monat in einen Monatsbereich auf. */
export function resolvePeriod(f: TransactionFilter, currentMonth: string): { from: string; to: string } | null {
  switch (f.preset) {
    case 'all':
      return null;
    case 'thisMonth':
      return { from: currentMonth, to: currentMonth };
    case 'lastMonth': {
      const m = addMonths(currentMonth, -1);
      return { from: m, to: m };
    }
    case 'last3':
      return { from: addMonths(currentMonth, -2), to: currentMonth };
    case 'thisYear':
      return { from: `${currentMonth.slice(0, 4)}-01`, to: currentMonth };
    case 'custom': {
      if (!f.fromMonth && !f.toMonth) return null;
      const from = f.fromMonth ?? '0000-01';
      const to = f.toMonth ?? '9999-12';
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

export function isFilterActive(f: TransactionFilter): boolean {
  return f.kind !== 'all' || f.categoryIds.length > 0 || f.preset !== 'all';
}

/** Anzahl aktiver Filter-Dimensionen (für das Badge am Filter-Button). */
export function activeFilterCount(f: TransactionFilter): number {
  return (f.kind !== 'all' ? 1 : 0) + (f.categoryIds.length > 0 ? 1 : 0) + (f.preset !== 'all' ? 1 : 0);
}

export function matchesFilter(
  entry: LedgerEntry,
  f: TransactionFilter,
  lookup: CategoryLookup,
  currentMonth: string,
): boolean {
  if (f.kind !== 'all') {
    if (categoryTypeOf(entry, lookup) === 'transfer') return false;
    if (f.kind === 'income' && entry.amountCents <= 0) return false;
    if (f.kind === 'expense' && entry.amountCents >= 0) return false;
  }
  if (f.categoryIds.length > 0) {
    const id = entry.categoryId ?? UNCATEGORIZED;
    if (!f.categoryIds.includes(id)) return false;
  }
  const range = resolvePeriod(f, currentMonth);
  if (range) {
    const m = monthKey(entry.bookingDate);
    if (m < range.from || m > range.to) return false;
  }
  return true;
}

export function filterTransactions<T extends LedgerEntry>(
  entries: T[],
  f: TransactionFilter,
  lookup: CategoryLookup,
  currentMonth: string,
): T[] {
  if (!isFilterActive(f)) return entries;
  return entries.filter((e) => matchesFilter(e, f, lookup, currentMonth));
}

/**
 * Kontostand der Bank am Ende jedes Monats (Saldo der letzten Buchung des Monats).
 * Monate ohne Bank-Buchung erhalten keinen Eintrag.
 */
export function monthEndBalances(
  entries: { accountId: string; bookingDate: string; balanceCents: number | null; dayOrder: number }[],
  accountId: string,
): Map<string, number> {
  const best = new Map<string, { date: string; order: number; cents: number }>();
  for (const e of entries) {
    if (e.accountId !== accountId || e.balanceCents == null) continue;
    const m = monthKey(e.bookingDate);
    const cur = best.get(m);
    if (!cur || e.bookingDate > cur.date || (e.bookingDate === cur.date && e.dayOrder > cur.order)) {
      best.set(m, { date: e.bookingDate, order: e.dayOrder, cents: e.balanceCents });
    }
  }
  return new Map([...best.entries()].map(([m, v]) => [m, v.cents]));
}
