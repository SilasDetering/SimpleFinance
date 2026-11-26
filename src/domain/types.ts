/**
 * Zentrale Domänen-Typen. Reines TypeScript ohne React/Expo-Abhängigkeiten,
 * damit die Logik in src/domain komplett mit Jest testbar bleibt.
 */

/** Konto-Typen. Aktuell genutzt: giro (ING) und cash (Bargeld-Kasse). */
export type AccountType = 'giro' | 'cash' | 'savings' | 'depot';

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  iban: string | null;
}

/**
 * expense  = Ausgabe-Kategorie
 * income   = Einnahme-Kategorie
 * transfer = Umbuchung (z. B. Sparen, Bargeld). Wird in Auswertungen ausgeblendet.
 */
export type CategoryType = 'expense' | 'income' | 'transfer';

export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
  type: CategoryType;
  /** Systemkategorien (Bargeld, Sonstiges) können nicht gelöscht werden. */
  isSystem: boolean;
  sortOrder: number;
}

/** Felder einer Buchung, gegen die eine Regel geprüft wird. */
export type RuleField = 'counterparty' | 'purpose' | 'bookingText' | 'any';

export interface Rule {
  id: string;
  categoryId: string;
  keyword: string;
  field: RuleField;
  /** Höhere Priorität gewinnt. Default-Regeln 0, gelernte Regeln 10, Bargeld 100. */
  priority: number;
  /** ISO-Zeitstempel; bei sonst gleichwertigen Regeln gewinnt die neuere */
  createdAt?: string;
}

export type TransactionSource = 'csv' | 'manual';

export interface Transaction {
  id: string;
  accountId: string;
  /** ISO-Datum YYYY-MM-DD */
  bookingDate: string;
  valueDate: string | null;
  counterparty: string;
  bookingText: string;
  purpose: string;
  /** Betrag in Cent, negativ = Abfluss */
  amountCents: number;
  /** Saldo nach der Buchung in Cent (nur CSV) */
  balanceCents: number | null;
  categoryId: string | null;
  /** true, wenn die Kategorie manuell gesetzt wurde (wird von Regeln nicht überschrieben) */
  categoryManual: boolean;
  note: string | null;
  source: TransactionSource;
  importId: string | null;
  dedupKey: string | null;
  /** Reihenfolge innerhalb eines Tages (aufsteigend = chronologisch) */
  dayOrder: number;
}

/** Eine aus der CSV gelesene, noch nicht gespeicherte Buchung. */
export interface ParsedTransaction {
  bookingDate: string;
  valueDate: string | null;
  counterparty: string;
  bookingText: string;
  purpose: string;
  amountCents: number;
  balanceCents: number | null;
  dayOrder: number;
}

/** Feste IDs der Standard-Konten und Systemkategorien. */
export const ACCOUNT_GIRO = 'giro-ing';
export const ACCOUNT_CASH = 'cash';
export const CATEGORY_CASH = 'cash';
export const CATEGORY_OTHER = 'other';
export const CATEGORY_INCOME = 'income';
export const CATEGORY_TRANSFER = 'transfer';
