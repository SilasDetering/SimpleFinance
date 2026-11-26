import { ACCOUNT_CASH, CATEGORY_CASH, CATEGORY_OTHER, type Category, type CategoryType } from './types';

/**
 * Bargeld-Logik und Einnahmen/Ausgaben-Klassifizierung.
 *
 * Die Bargeld-Kasse ist ein eigenes Konto (ACCOUNT_CASH), das NICHT in den Kontostand einfließt.
 *
 *  Buchung                         | Kasse      | Auswertung
 *  --------------------------------|------------|-------------------------------
 *  Abhebung (Bank, Kat. Bargeld)   | + Betrag   | keine Ausgabe (Umbuchung)
 *  Bareinzahlung (Bank, Bargeld)   | − Betrag   | keine Einnahme (Umbuchung)
 *  Bar-Ausgabe (Kasse, z. B. Bäcker)| − Betrag  | Ausgabe der gewählten Kategorie
 *  Bargeld erhalten (Kasse)        | + Betrag   | Einnahme der gewählten Kategorie
 *
 * So wird nichts doppelt gezählt: Abhebung und Einzahlung verschieben nur Geld
 * zwischen Konto und Kasse, die echte Ausgabe ist die manuelle Bar-Buchung.
 */

export interface LedgerEntry {
  accountId: string;
  bookingDate: string;
  amountCents: number;
  categoryId: string | null;
}

export type CategoryLookup = Map<string, Pick<Category, 'id' | 'type'>>;

export function toLookup(categories: Pick<Category, 'id' | 'type'>[]): CategoryLookup {
  return new Map(categories.map((c) => [c.id, c]));
}

/** Kategorie einer Buchung; nicht kategorisierte Buchungen zählen als "Sonstiges". */
export function effectiveCategoryId(entry: LedgerEntry): string {
  return entry.categoryId ?? CATEGORY_OTHER;
}

export function categoryTypeOf(entry: LedgerEntry, lookup: CategoryLookup): CategoryType {
  if (entry.categoryId === CATEGORY_CASH) return 'transfer';
  return lookup.get(effectiveCategoryId(entry))?.type ?? 'expense';
}

/** Zählt die Buchung in Auswertungen (Einnahmen/Ausgaben)? Umbuchungen und Bargeld-Bewegungen nicht. */
export function countsInStats(entry: LedgerEntry, lookup: CategoryLookup): boolean {
  return categoryTypeOf(entry, lookup) !== 'transfer';
}

/** Wirkung einer Buchung auf die Bargeld-Kasse in Cent. */
export function cashEffect(entry: LedgerEntry): number {
  if (entry.accountId === ACCOUNT_CASH) return entry.amountCents;
  // Bank-Buchung in Kategorie Bargeld: Abhebung (negativ am Konto) füllt die Kasse auf,
  // Bareinzahlung (positiv am Konto) leert sie.
  if (entry.categoryId === CATEGORY_CASH) return -entry.amountCents;
  return 0;
}

/** Aktueller Bargeld-Bestand (optional bis einschließlich eines Datums). */
export function cashBalance(entries: LedgerEntry[], untilIso?: string): number {
  let sum = 0;
  for (const e of entries) {
    if (untilIso && e.bookingDate > untilIso) continue;
    sum += cashEffect(e);
  }
  return sum;
}

export interface IncomeExpense {
  incomeCents: number;
  /** Ausgaben als positive Zahl */
  expenseCents: number;
  /** Einnahmen − Ausgaben */
  saldoCents: number;
}

/**
 * Einnahmen und Ausgaben nach Bargeld-Logik.
 * - Umbuchungen/Bargeld-Bewegungen werden ignoriert.
 * - Beträge in Ausgabe-Kategorien zählen als Ausgabe (eine Gutschrift dort, z. B. Rückerstattung, verringert sie).
 * - Beträge in Einnahme-Kategorien zählen als Einnahme.
 * Damit gilt immer: Saldo = Summe aller nicht-Umbuchungs-Beträge.
 */
export function incomeExpense(entries: LedgerEntry[], lookup: CategoryLookup): IncomeExpense {
  let income = 0;
  let expense = 0;
  for (const e of entries) {
    const type = categoryTypeOf(e, lookup);
    if (type === 'transfer') continue;
    if (type === 'income') income += e.amountCents;
    else expense -= e.amountCents;
  }
  return { incomeCents: income, expenseCents: expense, saldoCents: income - expense };
}

/** Art einer Bargeld-Bewegung, aus Sicht der Kasse. */
export type CashMovementKind = 'withdrawal' | 'received' | 'spent' | 'deposit';

export interface CashMovement<T extends LedgerEntry = LedgerEntry> {
  entry: T;
  kind: CashMovementKind;
  /** Wirkung auf die Kasse (+ füllt auf, − leert) */
  effectCents: number;
  /** Bestand nach dieser Bewegung */
  balanceAfterCents: number;
}

export interface CashBreakdown<T extends LedgerEntry = LedgerEntry> {
  /** Summen je Art, jeweils als positive Zahl */
  totals: Record<CashMovementKind, { cents: number; count: number }>;
  balanceCents: number;
  /** Alle Bewegungen, neueste zuerst */
  movements: CashMovement<T>[];
}

export function cashMovementKind(entry: LedgerEntry): CashMovementKind | null {
  if (entry.accountId === ACCOUNT_CASH) return entry.amountCents >= 0 ? 'received' : 'spent';
  if (entry.categoryId === CATEGORY_CASH) return entry.amountCents < 0 ? 'withdrawal' : 'deposit';
  return null;
}

/**
 * Schlüsselt den Bargeld-Bestand auf:
 * Bestand = Abhebungen + Bargeld erhalten − Bar-Ausgaben − Bareinzahlungen.
 * `entries` dürfen in beliebiger Reihenfolge kommen; für den laufenden Bestand wird nach Datum sortiert
 * (bei gleichem Datum nach `dayOrder`, falls vorhanden).
 */
export function cashBreakdown<T extends LedgerEntry & { dayOrder?: number }>(entries: T[]): CashBreakdown<T> {
  const totals: CashBreakdown['totals'] = {
    withdrawal: { cents: 0, count: 0 },
    received: { cents: 0, count: 0 },
    spent: { cents: 0, count: 0 },
    deposit: { cents: 0, count: 0 },
  };
  const relevant = entries
    .map((entry) => ({ entry, kind: cashMovementKind(entry) }))
    .filter((m): m is { entry: T; kind: CashMovementKind } => m.kind !== null)
    .sort((a, b) => a.entry.bookingDate.localeCompare(b.entry.bookingDate) || (a.entry.dayOrder ?? 0) - (b.entry.dayOrder ?? 0));
  let balance = 0;
  const movements: CashMovement<T>[] = [];
  for (const { entry, kind } of relevant) {
    const effect = cashEffect(entry);
    balance += effect;
    totals[kind].cents += Math.abs(effect);
    totals[kind].count++;
    movements.push({ entry, kind, effectCents: effect, balanceAfterCents: balance });
  }
  return { totals, balanceCents: balance, movements: movements.reverse() };
}
