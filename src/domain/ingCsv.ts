import Papa from 'papaparse';
import { parseGermanAmount } from './money';
import { parseGermanDate } from './dates';
import type { ParsedTransaction } from './types';

/**
 * Parser für den CSV-Export der ING ("Umsatzanzeige").
 *
 * Aufbau der Datei:
 *   - mehrere Kopfzeilen mit Kontoinfos (IBAN, Kontoname, Zeitraum, Saldo …)
 *   - eine Tabellen-Kopfzeile ("Buchung;Valuta;Auftraggeber/Empfänger;…;Betrag;…")
 *   - die Buchungen, i. d. R. absteigend nach Datum sortiert
 *
 * Die Tabellen-Kopfzeile wird gesucht, nicht über die Zeilennummer bestimmt.
 * Spalten werden über ihren Namen zugeordnet, damit kleine Format-Änderungen nicht stören.
 */

export interface IngCsvMeta {
  iban: string | null;
  accountName: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  /** Saldo aus dem Dateikopf in Cent */
  balanceCents: number | null;
}

export interface IngCsvResult {
  meta: IngCsvMeta;
  transactions: ParsedTransaction[];
  /** Zeilen, die nicht gelesen werden konnten (1-basierte Zeilennummer + Grund) */
  errors: { line: number; reason: string }[];
}

export class CsvFormatError extends Error {}

type Column = 'bookingDate' | 'valueDate' | 'counterparty' | 'bookingText' | 'purpose' | 'balance' | 'amount';

const COLUMN_ALIASES: Record<Column, string[]> = {
  bookingDate: ['buchung', 'buchungstag', 'buchungsdatum'],
  valueDate: ['valuta', 'wertstellungsdatum', 'wertstellung', 'valutadatum'],
  counterparty: ['auftraggeber/empfänger', 'auftraggeber/empfaenger', 'auftraggeber / empfänger', 'empfänger', 'auftraggeber', 'name'],
  bookingText: ['buchungstext', 'umsatzart'],
  purpose: ['verwendungszweck'],
  balance: ['saldo'],
  amount: ['betrag', 'betrag (eur)', 'umsatz'],
};

function norm(cell: unknown): string {
  return String(cell ?? '').replace(/^﻿/, '').trim().toLowerCase();
}

/** Findet die Zeile, die wie die Tabellen-Kopfzeile aussieht. */
export function findHeaderRow(rows: string[][]): number {
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].map(norm);
    const hasDate = cells.some((c) => COLUMN_ALIASES.bookingDate.includes(c));
    const hasAmount = cells.some((c) => COLUMN_ALIASES.amount.includes(c));
    if (hasDate && hasAmount && cells.filter(Boolean).length >= 3) return i;
  }
  return -1;
}

function mapColumns(header: string[]): Partial<Record<Column, number>> {
  const cells = header.map(norm);
  const result: Partial<Record<Column, number>> = {};
  (Object.keys(COLUMN_ALIASES) as Column[]).forEach((col) => {
    for (const alias of COLUMN_ALIASES[col]) {
      const idx = cells.indexOf(alias); // erstes Vorkommen (z. B. "Währung" doppelt)
      if (idx >= 0) {
        result[col] = idx;
        return;
      }
    }
  });
  return result;
}

function parseMeta(rows: string[][]): IngCsvMeta {
  const meta: IngCsvMeta = { iban: null, accountName: null, periodFrom: null, periodTo: null, balanceCents: null };
  for (const row of rows) {
    const key = norm(row[0]);
    const value = String(row[1] ?? '').trim();
    if (key === 'iban') meta.iban = value.replace(/\s+/g, ' ') || null;
    else if (key === 'kontoname') meta.accountName = value || null;
    else if (key === 'zeitraum') {
      const m = /(\d{1,2}\.\d{1,2}\.\d{2,4})\s*-\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/.exec(value);
      if (m) {
        meta.periodFrom = parseGermanDate(m[1]);
        meta.periodTo = parseGermanDate(m[2]);
      }
    } else if (key === 'saldo') meta.balanceCents = parseGermanAmount(value);
  }
  return meta;
}

function cleanText(s: unknown): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

export function parseIngCsv(text: string): IngCsvResult {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), {
    delimiter: ';',
    skipEmptyLines: 'greedy',
  });
  const rows = parsed.data.filter((r) => Array.isArray(r));
  const headerIdx = findHeaderRow(rows);
  if (headerIdx < 0) {
    throw new CsvFormatError('Keine Tabellen-Kopfzeile gefunden. Ist das ein ING-Export (Spalten "Buchung" und "Betrag")?');
  }
  const cols = mapColumns(rows[headerIdx]);
  if (cols.bookingDate === undefined || cols.amount === undefined) {
    throw new CsvFormatError('Spalten "Buchung" und "Betrag" wurden nicht gefunden.');
  }

  const meta = parseMeta(rows.slice(0, headerIdx));
  const transactions: ParsedTransaction[] = [];
  const errors: IngCsvResult['errors'] = [];
  const get = (row: string[], col: Column) => (cols[col] === undefined ? '' : row[cols[col]!] ?? '');

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (row.every((c) => !String(c ?? '').trim())) continue;
    const bookingDate = parseGermanDate(get(row, 'bookingDate'));
    const amountCents = parseGermanAmount(get(row, 'amount'));
    if (!bookingDate) {
      errors.push({ line: i + 1, reason: `Ungültiges Datum "${get(row, 'bookingDate')}"` });
      continue;
    }
    if (amountCents === null) {
      errors.push({ line: i + 1, reason: `Ungültiger Betrag "${get(row, 'amount')}"` });
      continue;
    }
    const balanceRaw = get(row, 'balance');
    transactions.push({
      bookingDate,
      valueDate: parseGermanDate(get(row, 'valueDate')),
      counterparty: cleanText(get(row, 'counterparty')),
      bookingText: cleanText(get(row, 'bookingText')),
      purpose: cleanText(get(row, 'purpose')),
      amountCents,
      balanceCents: balanceRaw ? parseGermanAmount(balanceRaw) : null,
      dayOrder: 0,
    });
  }

  // Reihenfolge innerhalb eines Tages: Die ING sortiert absteigend (neueste zuerst).
  // Wir vergeben dayOrder so, dass ein höherer Wert = später am Tag bedeutet.
  const descending =
    transactions.length > 1 && transactions[0].bookingDate > transactions[transactions.length - 1].bookingDate;
  const n = transactions.length;
  transactions.forEach((t, idx) => {
    t.dayOrder = descending ? n - 1 - idx : idx;
  });
  if (!descending && n > 1 && transactions[0].bookingDate === transactions[n - 1].bookingDate) {
    // Nur ein Tag in der Datei: ING-Standard ist absteigend
    transactions.forEach((t, idx) => (t.dayOrder = n - 1 - idx));
  }

  return { meta, transactions, errors };
}
