import { normalize } from './categorize';
import { categoryTypeOf, type CategoryLookup, type LedgerEntry } from './cash';
import { daysBetween, monthKey } from './dates';

/**
 * Erkennung wiederkehrender Zahlungen (Fixkosten/Abos).
 *
 * Eine Gruppe (gleicher Empfänger) gilt als wiederkehrend, wenn
 *  - sie in mindestens `minMonths` verschiedenen Monaten vorkommt,
 *  - höchstens etwa einmal pro Monat gebucht wird (keine Supermarkt-Einkäufe),
 *  - die Beträge stabil sind (Abweichung vom Median ≤ `tolerance`),
 *  - die letzte Buchung nicht länger als ~45 Tage vor dem letzten Datum der Daten liegt (noch aktiv).
 */

export interface RecurringPayment {
  name: string;
  /** typischer monatlicher Betrag (positiv) */
  monthlyCents: number;
  categoryId: string | null;
  lastDate: string;
  months: number;
}

export interface RecurringOptions {
  minMonths?: number;
  tolerance?: number;
  maxInactiveDays?: number;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** Entfernt wechselnde Ziffernfolgen (Rechnungsnummern) aus dem Empfängernamen für die Gruppierung. */
function groupKey(counterparty: string): string {
  return normalize(counterparty).replace(/\d{3,}/g, '').replace(/\s+/g, ' ').trim();
}

export function detectRecurring(
  entries: (LedgerEntry & { counterparty: string; alias?: string | null })[],
  lookup: CategoryLookup,
  opts: RecurringOptions = {},
): RecurringPayment[] {
  const { minMonths = 3, tolerance = 0.1, maxInactiveDays = 45 } = opts;
  if (entries.length === 0) return [];
  const lastDataDate = entries.reduce((m, e) => (e.bookingDate > m ? e.bookingDate : m), entries[0].bookingDate);

  const groups = new Map<string, (LedgerEntry & { counterparty: string; alias?: string | null })[]>();
  for (const e of entries) {
    if (e.amountCents >= 0) continue;
    if (categoryTypeOf(e, lookup) !== 'expense') continue;
    const key = groupKey(e.alias || e.counterparty);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(e);
  }

  const result: RecurringPayment[] = [];
  for (const list of groups.values()) {
    const months = new Set(list.map((e) => monthKey(e.bookingDate)));
    if (months.size < minMonths) continue;
    if (list.length > months.size * 1.25) continue; // mehrfach pro Monat -> kein Abo
    const amounts = list.map((e) => -e.amountCents);
    const med = median(amounts);
    const stable = amounts.filter((a) => Math.abs(a - med) <= med * tolerance).length;
    if (stable / amounts.length < 0.75) continue;
    const sorted = [...list].sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
    const last = sorted[sorted.length - 1];
    if (daysBetween(last.bookingDate, lastDataDate) > maxInactiveDays) continue;
    result.push({
      name: (last.alias || last.counterparty).trim(),
      monthlyCents: med,
      categoryId: last.categoryId,
      lastDate: last.bookingDate,
      months: months.size,
    });
  }
  return result.sort((a, b) => b.monthlyCents - a.monthlyCents);
}

export function recurringTotal(items: RecurringPayment[]): number {
  return items.reduce((s, r) => s + r.monthlyCents, 0);
}
