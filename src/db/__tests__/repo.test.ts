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
  addPromptExclusion,
  setTransactionAlias,
  deletePromptExclusion,
  getPromptExclusions,
  deleteAllData,
  deleteTransaction,
  exportBackup,
  getRules,
  restoreBackup,
  deleteCategory,
  getBankBalance,
  getCategories,
  getTransactions,
  importParsedCsv,
  learnRuleFromCorrection,
  recategorizeAll,
  saveCategory,
  setCategoryBudgetKind,
  setTransactionCategory,
  linkRepayment,
  setReimbursable,
  setReimburseState,
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

  it('speichert die Budget-Rolle einer Kategorie, auch im Backup', async () => {
    expect((await getCategories(db)).find((c) => c.id === 'groceries')?.budgetKind).toBeNull();
    await setCategoryBudgetKind(db, 'groceries', 'variable');
    const id = await saveCategory(db, { name: 'ETF', color: '#000000', icon: 'cart-outline', type: 'expense', budgetKind: 'saving' });
    const backup = await exportBackup(db);
    await deleteAllData(db);
    expect((await getCategories(db)).find((c) => c.id === 'groceries')?.budgetKind).toBeNull();
    await restoreBackup(db, parseBackup(JSON.stringify(backup)));
    const cats = await getCategories(db);
    expect(cats.find((c) => c.id === 'groceries')?.budgetKind).toBe('variable');
    expect(cats.find((c) => c.id === id)?.budgetKind).toBe('saving');
  });

  it('Erstattungen: markieren, zuordnen, abschließen, aufheben, Backup', async () => {
    const ticketId = await addManualCash(db, { kind: 'expense', amountCents: 5000, bookingDate: '2026-10-05', categoryId: 'mobility', description: 'Bahn' });
    const payId = await addManualCash(db, { kind: 'income', amountCents: 3000, bookingDate: '2026-10-20', categoryId: 'income', description: 'Max' });
    // Nur erstattbare Ausgaben lassen sich zuordnen
    await expect(linkRepayment(db, payId, ticketId)).rejects.toThrow();
    await setReimbursable(db, ticketId, true, ' Max ');
    await setReimbursable(db, payId, true); // Eingang kann nicht erstattbar sein
    await linkRepayment(db, payId, ticketId);
    let txs = await getTransactions(db);
    expect(txs.find((t) => t.id === ticketId)).toMatchObject({ reimburseState: 'open', reimburseFrom: 'Max' });
    expect(txs.find((t) => t.id === payId)).toMatchObject({ reimburseState: null, reimbursesId: ticketId });

    await setReimburseState(db, ticketId, 'done');
    const backup = await exportBackup(db);
    await deleteAllData(db);
    await restoreBackup(db, parseBackup(JSON.stringify(backup)));
    txs = await getTransactions(db);
    expect(txs.find((t) => t.id === ticketId)?.reimburseState).toBe('done');
    expect(txs.find((t) => t.id === payId)?.reimbursesId).toBe(ticketId);

    // Aufheben löst auch die Zuordnung der Rückzahlung
    await setReimbursable(db, ticketId, false);
    txs = await getTransactions(db);
    expect(txs.find((t) => t.id === ticketId)).toMatchObject({ reimburseState: null, reimburseFrom: null });
    expect(txs.find((t) => t.id === payId)?.reimbursesId).toBeNull();

    // Löschen einer Ausgabe löst Zuordnungen
    await setReimbursable(db, ticketId, true);
    await linkRepayment(db, payId, ticketId);
    await deleteTransaction(db, ticketId);
    expect((await getTransactions(db)).find((t) => t.id === payId)?.reimbursesId).toBeNull();
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

  it('gleichzeitige Schreibvorgänge laufen nacheinander statt sich zu überschneiden', async () => {
    const parsed = sample('ing-beispiel-aug-okt.csv');
    // Doppelt angetippter Import + direkt danach „Regeln anwenden": ohne Warteschlange
    // würde die zweite Transaktion mit „cannot start a transaction within a transaction" scheitern
    const [a, b, changed] = await Promise.all([
      importParsedCsv(db, ACCOUNT_GIRO, 'a.csv', parsed),
      importParsedCsv(db, ACCOUNT_GIRO, 'a.csv', parsed),
      recategorizeAll(db),
    ]);
    expect(a.newCount).toBe(parsed.transactions.length);
    expect(b.newCount).toBe(0);
    expect(b.duplicateCount).toBe(parsed.transactions.length);
    expect(changed).toBe(0);
    expect(await getTransactions(db)).toHaveLength(parsed.transactions.length);
  });

  it('eine fehlgeschlagene Transaktion blockiert die folgenden nicht', async () => {
    await expect(deleteCategory(db, 'cash')).rejects.toThrow();
    const parsed = sample('ing-beispiel-aug-okt.csv');
    const broken = { ...parsed, transactions: [{ ...parsed.transactions[0], amountCents: null as never }] };
    await expect(importParsedCsv(db, ACCOUNT_GIRO, 'kaputt.csv', broken)).rejects.toThrow();
    const ok = await importParsedCsv(db, ACCOUNT_GIRO, 'a.csv', parsed);
    expect(ok.newCount).toBe(parsed.transactions.length);
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

  it('einzelne Buchungen löschen; gelöschte Import-Buchungen kommen beim Re-Import nicht zurück', async () => {
    const parsed = sample('ing-beispiel-aug-okt.csv');
    await importParsedCsv(db, ACCOUNT_GIRO, 'a.csv', parsed);
    const cashId = await addManualCash(db, { kind: 'expense', amountCents: 500, bookingDate: '2026-10-30', categoryId: 'groceries', description: 'Bäcker' });
    const imported = (await getTransactions(db)).find((t) => t.source === 'csv')!;
    await deleteTransaction(db, imported.id);
    await deleteTransaction(db, cashId);
    let txs = await getTransactions(db);
    expect(txs).toHaveLength(60);
    expect(txs.some((t) => t.id === imported.id || t.id === cashId)).toBe(false);

    const again = await importParsedCsv(db, ACCOUNT_GIRO, 'a.csv', parsed);
    expect(again.newCount).toBe(0);
    expect(await getTransactions(db)).toHaveLength(60);

    // Bleibt über Backup erhalten, „Alles löschen" vergisst es
    const backup = await exportBackup(db);
    expect(backup.deleted_transactions).toHaveLength(1);
    await deleteAllData(db);
    await restoreBackup(db, parseBackup(JSON.stringify(backup)));
    expect((await importParsedCsv(db, ACCOUNT_GIRO, 'a.csv', parsed)).newCount).toBe(0);
    await deleteAllData(db);
    expect((await importParsedCsv(db, ACCOUNT_GIRO, 'a.csv', parsed)).newCount).toBe(61);
    txs = await getTransactions(db);
    expect(txs).toHaveLength(61);
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

  it('verwaltet Empfänger ohne Regel-Nachfrage (ohne Duplikate, inkl. Backup)', async () => {
    await addPromptExclusion(db, '  PayPal ');
    await addPromptExclusion(db, 'paypal');
    await addPromptExclusion(db, 'Amazon');
    let ex = await getPromptExclusions(db);
    expect(ex.map((e) => e.keyword)).toEqual(['Amazon', 'PayPal']);

    const backup = await exportBackup(db);
    await deleteAllData(db);
    expect(await getPromptExclusions(db)).toHaveLength(0);
    await restoreBackup(db, parseBackup(JSON.stringify(backup)));
    ex = await getPromptExclusions(db);
    expect(ex.map((e) => e.keyword)).toEqual(['Amazon', 'PayPal']);

    await deletePromptExclusion(db, ex[0].id);
    expect((await getPromptExclusions(db)).map((e) => e.keyword)).toEqual(['PayPal']);
  });

  it('ältere Backups ohne Ausnahmeliste lassen sich weiterhin laden', async () => {
    const backup = await exportBackup(db) as unknown as Record<string, unknown>;
    delete backup.prompt_exclusions;
    const parsed = parseBackup(JSON.stringify(backup));
    expect(parsed.prompt_exclusions).toEqual([]);
    await restoreBackup(db, parsed);
    expect(await getPromptExclusions(db)).toHaveLength(0);
  });

  it('eigener Name (Alias) wird angezeigt, von Regeln geprüft und gesichert', async () => {
    await importParsedCsv(db, ACCOUNT_GIRO, 'a.csv', sample('ing-beispiel-aug-okt.csv'));
    const tx = (await getTransactions(db)).find((t) => t.amountCents < 0 && t.source === 'csv')!;
    expect(tx.alias).toBeNull();
    await learnRuleFromCorrection(db, 'AldiTalk Flat', 'leisure');
    // Regel lernen setzt nur die Regel – die Buchung trifft sie erst mit dem Alias
    await setTransactionAlias(db, tx.id, '  AldiTalk Flat ');
    let after = (await getTransactions(db)).find((t) => t.id === tx.id)!;
    expect(after.alias).toBe('AldiTalk Flat');
    expect(after.counterparty).toBe(tx.counterparty);
    expect(after.categoryId).toBe('leisure');

    const backup = await exportBackup(db);
    await restoreBackup(db, parseBackup(JSON.stringify(backup)));
    after = (await getTransactions(db)).find((t) => t.id === tx.id)!;
    expect(after.alias).toBe('AldiTalk Flat');

    await setTransactionAlias(db, tx.id, '');
    after = (await getTransactions(db)).find((t) => t.id === tx.id)!;
    expect(after.alias).toBeNull();
    expect(after.categoryId).toBe(tx.categoryId);
  });

  it('übernimmt beim Import den eigenen Namen passender früherer Buchungen', async () => {
    await importParsedCsv(db, ACCOUNT_GIRO, 'a.csv', sample('ing-beispiel-aug-okt.csv'));
    const oct = (await getTransactions(db)).find((t) => t.counterparty === 'Spotify AB' && t.bookingDate === '2026-10-02')!;
    await learnRuleFromCorrection(db, 'Musik-Abo', 'leisure');
    await setTransactionAlias(db, oct.id, 'Musik-Abo');

    const summary = await importParsedCsv(db, ACCOUNT_GIRO, 'b.csv', sample('ing-beispiel-okt-nov-ueberlappend.csv'));
    expect(summary.aliasedCount).toBe(1);
    const nov = (await getTransactions(db)).find((t) => t.counterparty === 'Spotify AB' && t.bookingDate === '2026-11-02')!;
    expect(nov.alias).toBe('Musik-Abo');
    expect(nov.categoryId).toBe('leisure');
    // andere neue Buchungen bleiben ohne Namen
    expect((await getTransactions(db)).filter((t) => t.alias).map((t) => t.bookingDate).sort()).toEqual(['2026-10-02', '2026-11-02']);
  });
});
