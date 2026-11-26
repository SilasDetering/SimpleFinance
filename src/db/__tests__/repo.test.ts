/**
 * @jest-environment node
 *
 * Integrationstest für Schema + Repository gegen echtes SQLite (node:sqlite),
 * über einen kleinen Adapter mit derselben API wie expo-sqlite.
 */
import * as fs from 'fs';
import * as path from 'path';
import type { SQLiteDatabase } from 'expo-sqlite';
import { cashBalance, incomeExpense, toLookup } from '@/domain/cash';
import { BackupFormatError, parseBackup } from '@/domain/backup';
import { findConflictingRules } from '@/domain/categorize';
import { decodeText } from '@/domain/encoding';
import { detectRecurring } from '@/domain/recurring';
import { parseIngCsv } from '@/domain/ingCsv';
import { ACCOUNT_GIRO } from '@/domain/types';
import {
  addManualCash,
  deleteAllData,
  exportBackup,
  getRules,
  restoreBackup,
  deleteCategory,
  getBankBalance,
  getCategories,
  getTransactions,
  importParsedCsv,
  learnRuleFromCorrection,
  setTransactionCategory,
} from '../repo';
import { migrate } from '../schema';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite');

function createTestDb(): SQLiteDatabase {
  const raw = new DatabaseSync(':memory:');
  const norm = (params: unknown[]) => (params.length === 1 && Array.isArray(params[0]) ? params[0] : params);
  const db = {
    execAsync: async (sql: string) => raw.exec(sql),
    runAsync: async (sql: string, ...params: unknown[]) => {
      const r = raw.prepare(sql).run(...norm(params));
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    getFirstAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).get(...norm(params)) ?? null,
    getAllAsync: async (sql: string, ...params: unknown[]) => raw.prepare(sql).all(...norm(params)),
    withTransactionAsync: async (task: () => Promise<void>) => {
      raw.exec('BEGIN');
      try {
        await task();
        raw.exec('COMMIT');
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return db as unknown as SQLiteDatabase;
}

const sample = (name: string) =>
  parseIngCsv(decodeText(new Uint8Array(fs.readFileSync(path.join(__dirname, '../../../samples', name)))).text);

describe('Repository', () => {
  let db: SQLiteDatabase;
  beforeEach(async () => {
    db = createTestDb();
    await migrate(db);
  });

  it('legt Default-Kategorien an und Migration ist idempotent', async () => {
    await migrate(db);
    const cats = await getCategories(db);
    expect(cats).toHaveLength(13);
    expect(cats.find((c) => c.id === 'cash')?.isSystem).toBe(true);
  });

  it('importiert, kategorisiert und überspringt Duplikate bei Überlappung', async () => {
    const first = await importParsedCsv(db, ACCOUNT_GIRO, 'a.csv', sample('ing-beispiel-aug-okt.csv'));
    expect(first.newCount).toBe(61);
    expect(first.duplicateCount).toBe(0);
    expect(first.uncategorizedCount).toBe(3); // "Unbekannter Händler XY" je Monat

    const second = await importParsedCsv(db, ACCOUNT_GIRO, 'b.csv', sample('ing-beispiel-okt-nov-ueberlappend.csv'));
    expect(second.duplicateCount).toBeGreaterThan(0);
    expect(second.newCount + second.duplicateCount).toBe(29);

    const again = await importParsedCsv(db, ACCOUNT_GIRO, 'b.csv', sample('ing-beispiel-okt-nov-ueberlappend.csv'));
    expect(again.newCount).toBe(0);

    const txs = await getTransactions(db);
    expect(new Set(txs.map((t) => t.dedupKey)).size).toBe(txs.length);
    expect(txs.find((t) => t.bookingText === 'Bargeldauszahlung')?.categoryId).toBe('cash');
    expect(txs.find((t) => t.bookingText === 'Bareinzahlung')?.categoryId).toBe('cash');
  });

  it('Kontostand kommt aus dem neuesten Export', async () => {
    await importParsedCsv(db, ACCOUNT_GIRO, 'a.csv', sample('ing-beispiel-aug-okt.csv'));
    const parsed = sample('ing-beispiel-okt-nov-ueberlappend.csv');
    await importParsedCsv(db, ACCOUNT_GIRO, 'b.csv', parsed);
    const bal = await getBankBalance(db, ACCOUNT_GIRO);
    expect(bal?.cents).toBe(parsed.meta.balanceCents);
    expect(bal?.asOf).toBe('2026-11-25');
    // Saldo der neuesten Buchung stimmt mit dem Dateikopf überein
    const newest = (await getTransactions(db))[0];
    expect(newest.balanceCents).toBe(parsed.meta.balanceCents);
  });

  it('Bargeld-Kasse über Abhebungen, Einzahlung und manuelle Buchungen', async () => {
    await importParsedCsv(db, ACCOUNT_GIRO, 'a.csv', sample('ing-beispiel-aug-okt.csv'));
    // 3 Abhebungen à 100 €, 1 Einzahlung 50 €
    let txs = await getTransactions(db);
    expect(cashBalance(txs)).toBe(30000 - 5000);
    await addManualCash(db, { kind: 'expense', amountCents: 800, bookingDate: '2026-10-30', categoryId: 'groceries', description: 'Bäcker' });
    await addManualCash(db, { kind: 'income', amountCents: 2000, bookingDate: '2026-10-30', categoryId: 'income', description: 'Geschenk' });
    txs = await getTransactions(db);
    expect(cashBalance(txs)).toBe(25000 - 800 + 2000);

    const lookup = toLookup(await getCategories(db));
    const oct = txs.filter((t) => t.bookingDate.startsWith('2026-10'));
    const bankOnly = oct.filter((t) => t.source === 'csv');
    const withCash = incomeExpense(oct, lookup);
    const without = incomeExpense(bankOnly, lookup);
    expect(withCash.expenseCents - without.expenseCents).toBe(800);
    expect(withCash.incomeCents - without.incomeCents).toBe(2000);
  });

  it('gelernte Regel aus Korrektur wendet sich auf gleiche Empfänger an', async () => {
    await importParsedCsv(db, ACCOUNT_GIRO, 'a.csv', sample('ing-beispiel-aug-okt.csv'));
    let txs = await getTransactions(db);
    const unknown = txs.filter((t) => t.counterparty === 'Unbekannter Händler XY');
    expect(unknown.every((t) => t.categoryId === null)).toBe(true);
    await setTransactionCategory(db, unknown[0].id, 'leisure');
    const changed = await learnRuleFromCorrection(db, 'Unbekannter Händler XY', 'leisure');
    expect(changed).toBe(unknown.length - 1);
    txs = await getTransactions(db);
    expect(txs.filter((t) => t.counterparty === 'Unbekannter Händler XY').every((t) => t.categoryId === 'leisure')).toBe(true);
  });

  it('Systemkategorien sind nicht löschbar; normale Kategorien schon', async () => {
    await expect(deleteCategory(db, 'cash')).rejects.toThrow();
    await importParsedCsv(db, ACCOUNT_GIRO, 'a.csv', sample('ing-beispiel-aug-okt.csv'));
    await deleteCategory(db, 'health');
    const txs = await getTransactions(db);
    expect(txs.find((t) => t.counterparty === 'Apotheke am Dom')?.categoryId).toBeNull();
  });

  it('erkennt Fixkosten in den Beispieldaten', async () => {
    await importParsedCsv(db, ACCOUNT_GIRO, 'a.csv', sample('ing-beispiel-aug-okt.csv'));
    await importParsedCsv(db, ACCOUNT_GIRO, 'b.csv', sample('ing-beispiel-okt-nov-ueberlappend.csv'));
    const txs = await getTransactions(db);
    const names = detectRecurring(txs, toLookup(await getCategories(db))).map((r) => r.name);
    expect(names).toEqual([
      'Hausverwaltung Müller & Söhne',
      'Stadtwerke Köln GmbH',
      'DB Vertrieb GmbH',
      'HUK-COBURG Versicherung',
      'Fitnessstudio FitX',
      'Netflix International B.V.',
      'Spotify AB',
    ]);
  });

  it('alles löschen stellt Defaults wieder her', async () => {
    await importParsedCsv(db, ACCOUNT_GIRO, 'a.csv', sample('ing-beispiel-aug-okt.csv'));
    await deleteAllData(db);
    expect(await getTransactions(db)).toHaveLength(0);
    expect(await getCategories(db)).toHaveLength(13);
  });

  it('Backup exportieren und wiederherstellen ergibt denselben Stand', async () => {
    await importParsedCsv(db, ACCOUNT_GIRO, 'a.csv', sample('ing-beispiel-aug-okt.csv'));
    await addManualCash(db, { kind: 'expense', amountCents: 800, bookingDate: '2026-10-30', categoryId: 'groceries', description: 'Bäcker', note: 'lecker' });
    await learnRuleFromCorrection(db, 'Unbekannter Händler', 'leisure');
    const before = await exportBackup(db);
    const json = JSON.stringify(before);

    await deleteAllData(db);
    expect(await getTransactions(db)).toHaveLength(0);

    await restoreBackup(db, parseBackup(json));
    const after = await exportBackup(db);
    for (const table of ['accounts', 'categories', 'rules', 'imports', 'transactions'] as const) {
      const sort = (rows: Record<string, unknown>[]) => [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
      expect(sort(after[table])).toEqual(sort(before[table]));
    }
    expect((await getRules(db)).some((r) => r.keyword === 'Unbekannter Händler')).toBe(true);
  });

  it('Wiederherstellen ersetzt vorhandene Daten statt sie zu verdoppeln', async () => {
    await importParsedCsv(db, ACCOUNT_GIRO, 'a.csv', sample('ing-beispiel-aug-okt.csv'));
    const backup = await exportBackup(db);
    await restoreBackup(db, backup);
    expect(await getTransactions(db)).toHaveLength(backup.transactions.length);
  });

  it('erkennt ungültige Backups', () => {
    expect(() => parseBackup('kein json')).toThrow(BackupFormatError);
    expect(() => parseBackup('{"app":"Andere"}')).toThrow('kein SimpleFinance-Backup');
    expect(() => parseBackup('{"app":"SimpleFinance","version":99}')).toThrow('neueren App-Version');
    expect(() => parseBackup('{"app":"SimpleFinance","version":1,"accounts":[]}')).toThrow('unvollständig');
  });

  it('Umkategorisieren mit neuer Regel ersetzt die alte gelernte Regel', async () => {
    await importParsedCsv(db, ACCOUNT_GIRO, 'a.csv', sample('ing-beispiel-aug-okt.csv'));
    const name = 'Unbekannter Händler XY';
    let txs = await getTransactions(db);
    const [first, second] = txs.filter((t) => t.counterparty === name);
    await setTransactionCategory(db, first.id, 'leisure');
    await learnRuleFromCorrection(db, name, 'leisure');

    // Später anders entschieden, mit verändertem Stichwort
    await setTransactionCategory(db, second.id, 'shopping');
    const conflicts = findConflictingRules(second, await getRules(db), 'shopping');
    expect(conflicts.map((r) => r.keyword)).toEqual([name]);
    await learnRuleFromCorrection(db, 'Unbekannter Händler', 'shopping', 'counterparty', conflicts.map((r) => r.id));

    const rules = (await getRules(db)).filter((r) => r.priority === 10);
    expect(rules.map((r) => [r.keyword, r.categoryId])).toEqual([['Unbekannter Händler', 'shopping']]);
    txs = await getTransactions(db);
    const auto = txs.filter((t) => t.counterparty === name && !t.categoryManual);
    expect(auto.length).toBeGreaterThan(0);
    expect(auto.every((t) => t.categoryId === 'shopping')).toBe(true);
    // manuell gesetzte Kategorien bleiben unangetastet
    expect(txs.find((t) => t.id === first.id)?.categoryId).toBe('leisure');
  });
});
