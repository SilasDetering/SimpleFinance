import type { SQLiteDatabase } from 'expo-sqlite';
import { categorize, sortRules } from '@/domain/categorize';
import { splitDuplicates } from '@/domain/dedup';
import type { IngCsvResult } from '@/domain/ingCsv';
import {
  ACCOUNT_CASH,
  type Account,
  type Category,
  type CategoryType,
  type Rule,
  type RuleField,
  type Transaction,
} from '@/domain/types';
import { newId } from './id';
import { seedDefaultCategories } from './schema';

/* ---------- Mapping ---------- */

interface TxRow {
  id: string;
  account_id: string;
  booking_date: string;
  value_date: string | null;
  counterparty: string;
  booking_text: string;
  purpose: string;
  amount_cents: number;
  balance_cents: number | null;
  category_id: string | null;
  category_manual: number;
  note: string | null;
  source: 'csv' | 'manual';
  import_id: string | null;
  dedup_key: string | null;
  day_order: number;
}

const mapTx = (r: TxRow): Transaction => ({
  id: r.id,
  accountId: r.account_id,
  bookingDate: r.booking_date,
  valueDate: r.value_date,
  counterparty: r.counterparty,
  bookingText: r.booking_text,
  purpose: r.purpose,
  amountCents: r.amount_cents,
  balanceCents: r.balance_cents,
  categoryId: r.category_id,
  categoryManual: !!r.category_manual,
  note: r.note,
  source: r.source,
  importId: r.import_id,
  dedupKey: r.dedup_key,
  dayOrder: r.day_order,
});

interface CategoryRow {
  id: string;
  name: string;
  color: string;
  icon: string;
  type: CategoryType;
  is_system: number;
  sort_order: number;
}

const mapCategory = (r: CategoryRow): Category => ({
  id: r.id,
  name: r.name,
  color: r.color,
  icon: r.icon,
  type: r.type,
  isSystem: !!r.is_system,
  sortOrder: r.sort_order,
});

interface RuleRow {
  id: string;
  category_id: string;
  keyword: string;
  field: RuleField;
  priority: number;
}

const mapRule = (r: RuleRow): Rule => ({
  id: r.id,
  categoryId: r.category_id,
  keyword: r.keyword,
  field: r.field,
  priority: r.priority,
});

/* ---------- Konten ---------- */

export async function getAccounts(db: SQLiteDatabase): Promise<Account[]> {
  return db.getAllAsync<Account>('SELECT id, name, type, iban FROM accounts ORDER BY sort_order');
}

/* ---------- Kategorien ---------- */

export async function getCategories(db: SQLiteDatabase): Promise<Category[]> {
  const rows = await db.getAllAsync<CategoryRow>('SELECT * FROM categories ORDER BY sort_order, name');
  return rows.map(mapCategory);
}

export async function saveCategory(
  db: SQLiteDatabase,
  c: Omit<Category, 'id' | 'isSystem' | 'sortOrder'> & { id?: string },
): Promise<string> {
  if (c.id) {
    await db.runAsync(
      'UPDATE categories SET name = ?, color = ?, icon = ?, type = CASE WHEN is_system = 1 THEN type ELSE ? END WHERE id = ?',
      c.name, c.color, c.icon, c.type, c.id,
    );
    return c.id;
  }
  const id = newId();
  const max = await db.getFirstAsync<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM categories WHERE is_system = 0');
  await db.runAsync(
    'INSERT INTO categories (id, name, color, icon, type, is_system, sort_order) VALUES (?, ?, ?, ?, ?, 0, ?)',
    id, c.name, c.color, c.icon, c.type, (max?.m ?? 0) + 1,
  );
  return id;
}

/** Löscht eine Kategorie. Systemkategorien (Bargeld, Sonstiges) sind geschützt. Buchungen werden neu kategorisiert. */
export async function deleteCategory(db: SQLiteDatabase, id: string): Promise<void> {
  const row = await db.getFirstAsync<{ is_system: number }>('SELECT is_system FROM categories WHERE id = ?', id);
  if (!row) return;
  if (row.is_system) throw new Error('Diese Kategorie kann nicht gelöscht werden.');
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM rules WHERE category_id = ?', id);
    await db.runAsync('UPDATE transactions SET category_id = NULL, category_manual = 0 WHERE category_id = ?', id);
    await db.runAsync('DELETE FROM categories WHERE id = ?', id);
  });
  await recategorizeAll(db);
}

/* ---------- Regeln ---------- */

export async function getRules(db: SQLiteDatabase): Promise<Rule[]> {
  const rows = await db.getAllAsync<RuleRow>('SELECT id, category_id, keyword, field, priority FROM rules');
  return rows.map(mapRule);
}

export async function addRule(
  db: SQLiteDatabase,
  r: { categoryId: string; keyword: string; field?: RuleField; priority?: number },
): Promise<string> {
  const id = newId();
  await db.runAsync(
    'INSERT INTO rules (id, category_id, keyword, field, priority, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id, r.categoryId, r.keyword.trim(), r.field ?? 'any', r.priority ?? 0, new Date().toISOString(),
  );
  return id;
}

export async function updateRule(db: SQLiteDatabase, id: string, keyword: string, field: RuleField): Promise<void> {
  await db.runAsync('UPDATE rules SET keyword = ?, field = ? WHERE id = ?', keyword.trim(), field, id);
}

export async function deleteRule(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM rules WHERE id = ?', id);
}

/**
 * Wendet alle Regeln erneut auf importierte Buchungen an, deren Kategorie nicht manuell gesetzt wurde.
 * Gibt die Anzahl geänderter Buchungen zurück.
 */
export async function recategorizeAll(db: SQLiteDatabase): Promise<number> {
  const rules = sortRules(await getRules(db));
  const rows = await db.getAllAsync<TxRow>("SELECT * FROM transactions WHERE category_manual = 0 AND source = 'csv'");
  let changed = 0;
  await db.withTransactionAsync(async () => {
    for (const r of rows) {
      const next = categorize(
        { counterparty: r.counterparty, purpose: r.purpose, bookingText: r.booking_text },
        rules,
        { presorted: true },
      );
      if (next !== r.category_id) {
        await db.runAsync('UPDATE transactions SET category_id = ? WHERE id = ?', next, r.id);
        changed++;
      }
    }
  });
  return changed;
}

/* ---------- Buchungen ---------- */

export async function getTransactions(db: SQLiteDatabase): Promise<Transaction[]> {
  const rows = await db.getAllAsync<TxRow>(
    'SELECT * FROM transactions ORDER BY booking_date DESC, day_order DESC, created_at DESC',
  );
  return rows.map(mapTx);
}

export async function getTransaction(db: SQLiteDatabase, id: string): Promise<Transaction | null> {
  const row = await db.getFirstAsync<TxRow>('SELECT * FROM transactions WHERE id = ?', id);
  return row ? mapTx(row) : null;
}

export async function setTransactionCategory(db: SQLiteDatabase, id: string, categoryId: string | null): Promise<void> {
  await db.runAsync('UPDATE transactions SET category_id = ?, category_manual = 1 WHERE id = ?', categoryId, id);
}

export async function setTransactionNote(db: SQLiteDatabase, id: string, note: string): Promise<void> {
  await db.runAsync('UPDATE transactions SET note = ? WHERE id = ?', note.trim() || null, id);
}

/** Anzahl weiterer, nicht manuell kategorisierter Buchungen desselben Empfängers. */
export async function countSameCounterparty(db: SQLiteDatabase, counterparty: string, excludeId: string): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM transactions WHERE lower(counterparty) = lower(?) AND id != ? AND category_manual = 0 AND source = 'csv'",
    counterparty, excludeId,
  );
  return row?.n ?? 0;
}

/** Gelernte Regel aus einer manuellen Korrektur: Empfänger -> Kategorie. */
export async function learnRuleFromCorrection(
  db: SQLiteDatabase,
  keyword: string,
  categoryId: string,
  field: RuleField = 'counterparty',
): Promise<number> {
  // Eine gelernte Regel ersetzt eine ältere gelernte Regel mit demselben Stichwort
  await db.runAsync('DELETE FROM rules WHERE field = ? AND priority = 10 AND lower(keyword) = lower(?)', field, keyword.trim());
  await addRule(db, { categoryId, keyword, field, priority: 10 });
  return recategorizeAll(db);
}

export interface ManualCashInput {
  kind: 'expense' | 'income';
  amountCents: number; // positiv
  bookingDate: string;
  categoryId: string;
  description: string;
  note?: string;
}

/** Manuelle Bargeld-Buchung (Ausgabe verringert, Einnahme erhöht die Kasse). */
export async function addManualCash(db: SQLiteDatabase, input: ManualCashInput, id?: string): Promise<string> {
  const amount = input.kind === 'expense' ? -Math.abs(input.amountCents) : Math.abs(input.amountCents);
  if (id) {
    await db.runAsync(
      'UPDATE transactions SET booking_date = ?, counterparty = ?, amount_cents = ?, category_id = ?, note = ? WHERE id = ? AND source = ?',
      input.bookingDate, input.description.trim(), amount, input.categoryId, input.note?.trim() || null, id, 'manual',
    );
    return id;
  }
  const newTxId = newId();
  await db.runAsync(
    `INSERT INTO transactions (id, account_id, booking_date, value_date, counterparty, booking_text, purpose, amount_cents,
       balance_cents, category_id, category_manual, note, source, import_id, dedup_key, day_order, created_at)
     VALUES (?, ?, ?, NULL, ?, ?, '', ?, NULL, ?, 1, ?, 'manual', NULL, NULL, 0, ?)`,
    newTxId, ACCOUNT_CASH, input.bookingDate, input.description.trim(),
    input.kind === 'expense' ? 'Bar-Ausgabe' : 'Bargeld erhalten', amount, input.categoryId,
    input.note?.trim() || null, new Date().toISOString(),
  );
  return newTxId;
}

export async function deleteTransaction(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync("DELETE FROM transactions WHERE id = ? AND source = 'manual'", id);
}

/* ---------- Import ---------- */

export interface ImportSummary {
  newCount: number;
  duplicateCount: number;
  uncategorizedCount: number;
  errorCount: number;
  periodFrom: string | null;
  periodTo: string | null;
}

export async function importParsedCsv(
  db: SQLiteDatabase,
  accountId: string,
  fileName: string | null,
  parsed: IngCsvResult,
): Promise<ImportSummary> {
  const existing = await db.getAllAsync<{ dedup_key: string }>(
    'SELECT dedup_key FROM transactions WHERE account_id = ? AND dedup_key IS NOT NULL',
    accountId,
  );
  const { fresh, duplicates } = splitDuplicates(accountId, parsed.transactions, new Set(existing.map((r) => r.dedup_key)));
  const rules = sortRules(await getRules(db));
  const importId = newId();
  const now = new Date().toISOString();
  let uncategorized = 0;
  const dates = parsed.transactions.map((t) => t.bookingDate).sort();
  const periodFrom = parsed.meta.periodFrom ?? dates[0] ?? null;
  const periodTo = parsed.meta.periodTo ?? dates[dates.length - 1] ?? null;

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO imports (id, account_id, file_name, period_from, period_to, balance_cents, new_count, duplicate_count, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      importId, accountId, fileName, periodFrom, periodTo, parsed.meta.balanceCents, fresh.length, duplicates, now,
    );
    if (parsed.meta.iban) {
      await db.runAsync('UPDATE accounts SET iban = COALESCE(iban, ?) WHERE id = ?', parsed.meta.iban, accountId);
    }
    for (const { tx, key } of fresh) {
      const categoryId = categorize(tx, rules, { presorted: true });
      if (!categoryId) uncategorized++;
      await db.runAsync(
        `INSERT INTO transactions (id, account_id, booking_date, value_date, counterparty, booking_text, purpose, amount_cents,
           balance_cents, category_id, category_manual, note, source, import_id, dedup_key, day_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 'csv', ?, ?, ?, ?)`,
        newId(), accountId, tx.bookingDate, tx.valueDate, tx.counterparty, tx.bookingText, tx.purpose,
        tx.amountCents, tx.balanceCents, categoryId, importId, key, tx.dayOrder, now,
      );
    }
  });

  return {
    newCount: fresh.length,
    duplicateCount: duplicates,
    uncategorizedCount: uncategorized,
    errorCount: parsed.errors.length,
    periodFrom,
    periodTo,
  };
}

/**
 * Aktueller Kontostand eines Bankkontos: der Saldo aus dem Kopf des neuesten Exports
 * (falls vorhanden), sonst der Saldo der jüngsten Buchung.
 */
export async function getBankBalance(db: SQLiteDatabase, accountId: string): Promise<{ cents: number; asOf: string } | null> {
  const imp = await db.getFirstAsync<{ balance_cents: number | null; period_to: string | null }>(
    'SELECT balance_cents, period_to FROM imports WHERE account_id = ? AND balance_cents IS NOT NULL ORDER BY period_to DESC, imported_at DESC LIMIT 1',
    accountId,
  );
  const tx = await db.getFirstAsync<{ balance_cents: number; booking_date: string }>(
    'SELECT balance_cents, booking_date FROM transactions WHERE account_id = ? AND balance_cents IS NOT NULL ORDER BY booking_date DESC, day_order DESC LIMIT 1',
    accountId,
  );
  if (imp?.balance_cents != null && imp.period_to && (!tx || imp.period_to >= tx.booking_date)) {
    return { cents: imp.balance_cents, asOf: imp.period_to };
  }
  if (tx) return { cents: tx.balance_cents, asOf: tx.booking_date };
  return null;
}

/* ---------- Backup / Löschen ---------- */

export async function exportBackup(db: SQLiteDatabase) {
  return {
    app: 'SimpleFinance',
    version: 1,
    exportedAt: new Date().toISOString(),
    accounts: await db.getAllAsync('SELECT * FROM accounts'),
    categories: await db.getAllAsync('SELECT * FROM categories'),
    rules: await db.getAllAsync('SELECT * FROM rules'),
    imports: await db.getAllAsync('SELECT * FROM imports'),
    transactions: await db.getAllAsync('SELECT * FROM transactions'),
  };
}

/** Löscht alle Buchungen, Importe, Regeln und eigenen Kategorien und stellt die Defaults wieder her. */
export async function deleteAllData(db: SQLiteDatabase): Promise<void> {
  await db.withTransactionAsync(async () => {
    await db.execAsync('DELETE FROM transactions; DELETE FROM imports; DELETE FROM rules; DELETE FROM categories; UPDATE accounts SET iban = NULL;');
    await seedDefaultCategories(db);
  });
}
