/**
 * Format und Prüfung des JSON-Backups. Die Tabellen werden 1:1 als Zeilen gespeichert
 * (Spaltennamen wie in SQLite), damit ein Backup ohne Umrechnung zurückgespielt werden kann.
 */

export const BACKUP_TABLES = ['accounts', 'categories', 'rules', 'imports', 'transactions', 'prompt_exclusions'] as const;
/** Tabellen, die in älteren Backups noch fehlen dürfen (werden dann als leer behandelt). */
const OPTIONAL_TABLES: readonly string[] = ['prompt_exclusions'];
export type BackupTable = (typeof BACKUP_TABLES)[number];
export type BackupRow = Record<string, unknown>;

export interface BackupFile {
  app: 'SimpleFinance';
  version: number;
  exportedAt: string;
  accounts: BackupRow[];
  categories: BackupRow[];
  rules: BackupRow[];
  imports: BackupRow[];
  transactions: BackupRow[];
  prompt_exclusions: BackupRow[];
}

export const BACKUP_VERSION = 1;

export class BackupFormatError extends Error {}

/** Liest und prüft ein Backup. Wirft BackupFormatError mit verständlicher Meldung. */
export function parseBackup(text: string): BackupFile {
  let data: unknown;
  try {
    data = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new BackupFormatError('Die Datei ist kein gültiges JSON.');
  }
  if (!data || typeof data !== 'object') throw new BackupFormatError('Die Datei ist kein SimpleFinance-Backup.');
  const b = data as Record<string, unknown>;
  if (b.app !== 'SimpleFinance') throw new BackupFormatError('Die Datei ist kein SimpleFinance-Backup.');
  if (typeof b.version !== 'number' || b.version > BACKUP_VERSION) {
    throw new BackupFormatError('Dieses Backup stammt aus einer neueren App-Version und kann nicht gelesen werden.');
  }
  for (const table of BACKUP_TABLES) {
    if (b[table] === undefined && OPTIONAL_TABLES.includes(table)) b[table] = [];
    const rows = b[table];
    if (!Array.isArray(rows) || rows.some((r) => !r || typeof r !== 'object' || typeof (r as BackupRow).id !== 'string')) {
      throw new BackupFormatError(`Das Backup ist unvollständig (${table}).`);
    }
  }
  const categoryIds = new Set((b.categories as BackupRow[]).map((c) => c.id));
  for (const tx of b.transactions as BackupRow[]) {
    if (typeof tx.amount_cents !== 'number' || typeof tx.booking_date !== 'string') {
      throw new BackupFormatError('Das Backup enthält fehlerhafte Buchungen.');
    }
    if (tx.category_id != null && !categoryIds.has(tx.category_id)) {
      throw new BackupFormatError('Das Backup enthält Buchungen mit unbekannter Kategorie.');
    }
  }
  return b as unknown as BackupFile;
}

/** Kurze Zusammenfassung für die Rückfrage vor dem Wiederherstellen. */
export function describeBackup(b: BackupFile): string {
  const date = b.exportedAt ? new Date(b.exportedAt) : null;
  const when =
    date && !Number.isNaN(date.getTime())
      ? `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`
      : 'unbekanntem Datum';
  return `Backup vom ${when}: ${b.transactions.length} Buchungen, ${b.categories.length} Kategorien, ${b.rules.length} Regeln.`;
}
