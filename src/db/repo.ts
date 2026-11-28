import type { SQLiteDatabase } from 'expo-sqlite';
import { BACKUP_TABLES, BACKUP_VERSION, type BackupFile, type BackupRow, type BackupTable } from '@/domain/backup';
import { categorize, LEARNED_PRIORITY, sortRules, type PromptExclusion } from '@/domain/categorize';
import { splitDuplicates } from '@/domain/dedup';
import { DEFAULT_CATEGORIES } from '@/domain/defaults';
import type { IngCsvResult } from '@/domain/ingCsv';
import {
  ACCOUNT_CASH,
  type BudgetKind,
  type Category,
  type CategoryType,
  type ParsedTransaction,
  type ReimburseState,
  type Rule,
  type RuleField,
  type Transaction,
} from '@/domain/types';
import { findAlias } from '@/domain/alias';
import { newId } from './id';
import { seedDefaultCategories } from './schema';

/* ---------- Transaktionen ---------- */

/*
 * expo-sqlite teilt sich eine Verbindung: Startet eine zweite Transaktion, während die erste
 * noch läuft (z. B. doppelt getippt oder Regel anlegen während eines Imports), schlägt sie mit
 * „cannot start a transaction within a transaction" fehl. Schreib-Transaktionen laufen deshalb
 * nacheinander. Nicht verschachteln: innerhalb von `task` kein weiteres inTransaction aufrufen.
 */
const txQueues = new WeakMap<SQLiteDatabase, Promise<unknown>>();

function inTransaction(db: SQLiteDatabase, task: () => Promise<void>): Promise<void> {
  const previous = txQueues.get(db) ?? Promise.resolve();
  const run = previous.then(() => db.withTransactionAsync(task));
  txQueues.set(db, run.catch(() => undefined));
  return run;
}

/* ---------- Mapping ---------- */

interface TxRow {
  id: string;
  account_id: string;
  booking_date: string;
  value_date: string | null;
  counterparty: string;
  alias: string | null;
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
  reimburse_state: ReimburseState | null;
  reimburse_from: string | null;
  reimburses_id: string | null;
}

const mapTx = (r: TxRow): Transaction => ({
  id: r.id,
  accountId: r.account_id,
  bookingDate: r.booking_date,
  valueDate: r.value_date,
  counterparty: r.counterparty,
  alias: r.alias ?? null,
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
  reimburseState: r.reimburse_state ?? null,
  reimburseFrom: r.reimburse_from ?? null,
  reimbursesId: r.reimburses_id ?? null,
});

interface CategoryRow {
  id: string;
  name: string;
  color: string;
  icon: string;
  type: CategoryType;
  is_system: number;
  sort_order: number;
  budget_kind: BudgetKind | null;
}

const mapCategory = (r: CategoryRow): Category => ({
  id: r.id,
  name: r.name,
  color: r.color,
  icon: r.icon,
  type: r.type,
  isSystem: !!r.is_system,
  sortOrder: r.sort_order,
  budgetKind: r.budget_kind ?? null,
});

interface RuleRow {
  id: string;
  category_id: string;
  keyword: string;
  field: RuleField;
  priority: number;
  created_at: string;
}

const mapRule = (r: RuleRow): Rule => ({
  id: r.id,
  categoryId: r.category_id,
  keyword: r.keyword,
  field: r.field,
  priority: r.priority,
  createdAt: r.created_at,
});

/* ---------- Kategorien ---------- */

export async function getCategories(db: SQLiteDatabase): Promise<Category[]> {
  const rows = await db.getAllAsync<CategoryRow>('SELECT * FROM categories ORDER BY sort_order, name');
  return rows.map(mapCategory);
}

export async function saveCategory(
  db: SQLiteDatabase,
  c: Omit<Category, 'id' | 'isSystem' | 'sortOrder'> & { id?: string },
): Promise<string> {
  const kind = c.budgetKind ?? null;
  if (c.id) {
    await db.runAsync(
      'UPDATE categories SET name = ?, color = ?, icon = ?, type = CASE WHEN is_system = 1 THEN type ELSE ? END, budget_kind = ? WHERE id = ?',
      c.name, c.color, c.icon, c.type, kind, c.id,
    );
    return c.id;
  }
  const id = newId();
  const max = await db.getFirstAsync<{ m: number | null }>('SELECT MAX(sort_order) AS m FROM categories WHERE is_system = 0');
  await db.runAsync(
    'INSERT INTO categories (id, name, color, icon, type, is_system, sort_order, budget_kind) VALUES (?, ?, ?, ?, ?, 0, ?, ?)',
    id, c.name, c.color, c.icon, c.type, (max?.m ?? 0) + 1, kind,
  );
  return id;
}

/** Setzt die Rolle einer Kategorie im Monatsbudget (fix, variabel, Sparen …). */
export async function setCategoryBudgetKind(db: SQLiteDatabase, id: string, kind: BudgetKind | null): Promise<void> {
  await db.runAsync('UPDATE categories SET budget_kind = ? WHERE id = ?', kind, id);
}

/** Löscht eine Kategorie. Systemkategorien (Bargeld, Sonstiges) sind geschützt. Buchungen werden neu kategorisiert. */
export async function deleteCategory(db: SQLiteDatabase, id: string): Promise<void> {
  const row = await db.getFirstAsync<{ is_system: number }>('SELECT is_system FROM categories WHERE id = ?', id);
  if (!row) return;
  if (row.is_system) throw new Error('Diese Kategorie kann nicht gelöscht werden.');
  await inTransaction(db, async () => {
    await db.runAsync('DELETE FROM rules WHERE category_id = ?', id);
    await db.runAsync('UPDATE transactions SET category_id = NULL, category_manual = 0 WHERE category_id = ?', id);
    await db.runAsync('DELETE FROM categories WHERE id = ?', id);
  });
  await recategorizeAll(db);
}

/* ---------- Regeln ---------- */

export async function getRules(db: SQLiteDatabase): Promise<Rule[]> {
  const rows = await db.getAllAsync<RuleRow>('SELECT id, category_id, keyword, field, priority, created_at FROM rules');
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

export async function deleteRule(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM rules WHERE id = ?', id);
}

/**
 * Wendet alle Regeln erneut auf importierte Buchungen an, deren Kategorie nicht manuell gesetzt wurde.
 * Gibt die Anzahl geänderter Buchungen zurück.
 */
export async function recategorizeAll(db: SQLiteDatabase): Promise<number> {
  let changed = 0;
  await inTransaction(db, async () => {
    const rules = sortRules(await getRules(db));
    const rows = await db.getAllAsync<TxRow>("SELECT * FROM transactions WHERE category_manual = 0 AND source = 'csv'");
    for (const r of rows) {
      const next = categorize(
        { counterparty: r.counterparty, alias: r.alias, purpose: r.purpose, bookingText: r.booking_text },
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

export async function setTransactionCategory(db: SQLiteDatabase, id: string, categoryId: string | null): Promise<void> {
  await db.runAsync('UPDATE transactions SET category_id = ?, category_manual = 1 WHERE id = ?', categoryId, id);
}

/**
 * Setzt den eigenen Namen (Alias) einer Buchung. Leerer Text entfernt ihn.
 * Ist die Kategorie nicht manuell gesetzt, werden die Regeln danach neu angewendet,
 * damit eine Regel auf den Alias (z. B. „AldiTalk Flat") sofort greift.
 */
export async function setTransactionAlias(db: SQLiteDatabase, id: string, alias: string): Promise<void> {
  const value = alias.trim() || null;
  await db.runAsync('UPDATE transactions SET alias = ? WHERE id = ?', value, id);
  const row = await db.getFirstAsync<TxRow>("SELECT * FROM transactions WHERE id = ? AND category_manual = 0 AND source = 'csv'", id);
  if (!row) return;
  const next = categorize(
    { counterparty: row.counterparty, alias: row.alias, purpose: row.purpose, bookingText: row.booking_text },
    await getRules(db),
  );
  if (next !== row.category_id) await db.runAsync('UPDATE transactions SET category_id = ? WHERE id = ?', next, id);
}

export async function setTransactionNote(db: SQLiteDatabase, id: string, note: string): Promise<void> {
  await db.runAsync('UPDATE transactions SET note = ? WHERE id = ?', note.trim() || null, id);
}

/** Gelernte Regel aus einer manuellen Korrektur: Empfänger -> Kategorie. */
export async function learnRuleFromCorrection(
  db: SQLiteDatabase,
  keyword: string,
  categoryId: string,
  field: RuleField = 'counterparty',
  replaceRuleIds: string[] = [],
): Promise<number> {
  // Eine gelernte Regel ersetzt eine ältere gelernte Regel mit demselben Stichwort
  // sowie die ausdrücklich übergebenen widersprüchlichen Regeln (siehe findConflictingRules)
  await inTransaction(db, async () => {
    await db.runAsync(
      'DELETE FROM rules WHERE field = ? AND priority = ? AND lower(keyword) = lower(?)',
      field, LEARNED_PRIORITY, keyword.trim(),
    );
    for (const id of replaceRuleIds) await deleteRule(db, id);
    await addRule(db, { categoryId, keyword, field, priority: LEARNED_PRIORITY });
  });
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
  await inTransaction(db, async () => {
    // Zuordnungen in beide Richtungen lösen, damit nichts ins Leere zeigt
    await db.runAsync('UPDATE transactions SET reimburses_id = NULL WHERE reimburses_id = ?', id);
    await db.runAsync("DELETE FROM transactions WHERE id = ? AND source = 'manual'", id);
  });
}

/* ---------- Erstattungen ---------- */

/**
 * Markiert eine Ausgabe als erstattbar (open) bzw. nimmt die Markierung zurück (null).
 * Beim Zurücknehmen werden zugeordnete Geldeingänge wieder normale Einnahmen.
 */
export async function setReimbursable(db: SQLiteDatabase, id: string, reimbursable: boolean, from?: string): Promise<void> {
  await inTransaction(db, async () => {
    if (reimbursable) {
      await db.runAsync(
        "UPDATE transactions SET reimburse_state = 'open', reimburse_from = ?, reimburses_id = NULL WHERE id = ? AND amount_cents < 0",
        from?.trim() || null, id,
      );
    } else {
      await db.runAsync('UPDATE transactions SET reimburse_state = NULL, reimburse_from = NULL WHERE id = ?', id);
      await db.runAsync('UPDATE transactions SET reimburses_id = NULL WHERE reimburses_id = ?', id);
    }
  });
}

/** Wer erstattet (nur Anzeige). */
export async function setReimburseFrom(db: SQLiteDatabase, id: string, from: string): Promise<void> {
  await db.runAsync('UPDATE transactions SET reimburse_from = ? WHERE id = ?', from.trim() || null, id);
}

/** Erstattung abschließen (done: Rest zählt als Ausgabe) oder wieder öffnen (open). */
export async function setReimburseState(db: SQLiteDatabase, id: string, state: ReimburseState): Promise<void> {
  await db.runAsync('UPDATE transactions SET reimburse_state = ? WHERE id = ? AND reimburse_state IS NOT NULL', state, id);
}

/** Ordnet einen Geldeingang einer erstattbaren Ausgabe zu (expenseId null löst die Zuordnung). */
export async function linkRepayment(db: SQLiteDatabase, paymentId: string, expenseId: string | null): Promise<void> {
  if (expenseId) {
    const expense = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM transactions WHERE id = ? AND reimburse_state IS NOT NULL AND amount_cents < 0',
      expenseId,
    );
    if (!expense) throw new Error('Diese Ausgabe ist nicht als erstattbar markiert.');
  }
  await db.runAsync(
    'UPDATE transactions SET reimburses_id = ? WHERE id = ? AND amount_cents > 0 AND reimburse_state IS NULL',
    expenseId, paymentId,
  );
}

/* ---------- Import ---------- */

export interface ImportSummary {
  newCount: number;
  duplicateCount: number;
  uncategorizedCount: number;
  /** Buchungen, die automatisch einen eigenen Namen von einer früheren Buchung bekommen haben */
  aliasedCount: number;
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
  let aliased = 0;
  const importId = newId();
  const now = new Date().toISOString();
  let uncategorized = 0;
  const dates = parsed.transactions.map((t) => t.bookingDate).sort();
  const periodFrom = parsed.meta.periodFrom ?? dates[0] ?? null;
  const periodTo = parsed.meta.periodTo ?? dates[dates.length - 1] ?? null;

  let fresh: { tx: ParsedTransaction; key: string }[] = [];
  let duplicates = 0;

  // Vorhandene Buchungen innerhalb der Transaktion lesen, damit ein zweiter Import
  // direkt danach die gerade eingefügten Buchungen als Duplikate erkennt
  await inTransaction(db, async () => {
    const existing = await db.getAllAsync<{ dedup_key: string }>(
      'SELECT dedup_key FROM transactions WHERE account_id = ? AND dedup_key IS NOT NULL',
      accountId,
    );
    const split = splitDuplicates(accountId, parsed.transactions, new Set(existing.map((r) => r.dedup_key)));
    const rules = sortRules(await getRules(db));
    const templates = (
      await db.getAllAsync<{ counterparty: string; purpose: string; amount_cents: number; alias: string; booking_date: string }>(
        "SELECT counterparty, purpose, amount_cents, alias, booking_date FROM transactions WHERE account_id = ? AND alias IS NOT NULL AND alias != ''",
        accountId,
      )
    ).map((r) => ({ counterparty: r.counterparty, purpose: r.purpose, amountCents: r.amount_cents, alias: r.alias, bookingDate: r.booking_date }));
    fresh = split.fresh;
    duplicates = split.duplicates;
    await db.runAsync(
      `INSERT INTO imports (id, account_id, file_name, period_from, period_to, balance_cents, new_count, duplicate_count, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      importId, accountId, fileName, periodFrom, periodTo, parsed.meta.balanceCents, fresh.length, duplicates, now,
    );
    if (parsed.meta.iban) {
      await db.runAsync('UPDATE accounts SET iban = COALESCE(iban, ?) WHERE id = ?', parsed.meta.iban, accountId);
    }
    for (const { tx, key } of fresh) {
      const alias = templates.length ? findAlias(tx, templates) : null;
      if (alias) aliased++;
      const categoryId = categorize({ ...tx, alias }, rules, { presorted: true });
      if (!categoryId) uncategorized++;
      await db.runAsync(
        `INSERT INTO transactions (id, account_id, booking_date, value_date, counterparty, alias, booking_text, purpose, amount_cents,
           balance_cents, category_id, category_manual, note, source, import_id, dedup_key, day_order, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, 'csv', ?, ?, ?, ?)`,
        newId(), accountId, tx.bookingDate, tx.valueDate, tx.counterparty, alias, tx.bookingText, tx.purpose,
        tx.amountCents, tx.balanceCents, categoryId, importId, key, tx.dayOrder, now,
      );
    }
  });

  return {
    newCount: fresh.length,
    duplicateCount: duplicates,
    uncategorizedCount: uncategorized,
    aliasedCount: aliased,
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

export async function exportBackup(db: SQLiteDatabase): Promise<BackupFile> {
  return {
    app: 'SimpleFinance',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    accounts: await db.getAllAsync<BackupRow>('SELECT * FROM accounts'),
    categories: await db.getAllAsync<BackupRow>('SELECT * FROM categories'),
    rules: await db.getAllAsync<BackupRow>('SELECT * FROM rules'),
    imports: await db.getAllAsync<BackupRow>('SELECT * FROM imports'),
    transactions: await db.getAllAsync<BackupRow>('SELECT * FROM transactions'),
    prompt_exclusions: await db.getAllAsync<BackupRow>('SELECT * FROM prompt_exclusions'),
  };
}

/**
 * Spielt ein Backup zurück und ersetzt dabei alle vorhandenen Daten.
 * Es werden nur Spalten übernommen, die es in der aktuellen Datenbank gibt,
 * damit auch Backups älterer App-Versionen funktionieren.
 */
export async function restoreBackup(db: SQLiteDatabase, backup: BackupFile): Promise<void> {
  const columns = new Map<BackupTable, Set<string>>();
  for (const table of BACKUP_TABLES) {
    const info = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
    columns.set(table, new Set(info.map((c) => c.name)));
  }
  await inTransaction(db, async () => {
    await db.execAsync(
      'DELETE FROM transactions; DELETE FROM imports; DELETE FROM rules; DELETE FROM categories; DELETE FROM prompt_exclusions;',
    );
    // Reihenfolge wegen Fremdschlüsseln: Konten, Kategorien, Regeln, Importe, Buchungen
    for (const table of BACKUP_TABLES) {
      const allowed = columns.get(table)!;
      for (const row of backup[table]) {
        const keys = Object.keys(row).filter((k) => allowed.has(k));
        if (keys.length === 0) continue;
        const verb = table === 'accounts' ? 'INSERT OR REPLACE' : 'INSERT';
        await db.runAsync(
          `${verb} INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
          keys.map((k) => row[k] as string | number | null),
        );
      }
    }
    // Systemkategorien müssen immer existieren
    for (const c of DEFAULT_CATEGORIES.filter((x) => x.isSystem)) {
      await db.runAsync(
        'INSERT OR IGNORE INTO categories (id, name, color, icon, type, is_system, sort_order) VALUES (?, ?, ?, ?, ?, 1, 99)',
        c.id, c.name, c.color, c.icon, c.type,
      );
    }
  });
}

/** Löscht alle Buchungen, Importe, Regeln und eigenen Kategorien und stellt die Defaults wieder her. */
export async function deleteAllData(db: SQLiteDatabase): Promise<void> {
  await inTransaction(db, async () => {
    await db.execAsync('DELETE FROM transactions; DELETE FROM imports; DELETE FROM rules; DELETE FROM categories; DELETE FROM prompt_exclusions; UPDATE accounts SET iban = NULL;');
    await seedDefaultCategories(db);
  });
}

/* ---------- Ausnahmen für die Regel-Nachfrage ---------- */

/** Empfänger (Stichwörter), bei denen nach manueller Umkategorisierung nicht nach einer Regel gefragt wird. */
export async function getPromptExclusions(db: SQLiteDatabase): Promise<PromptExclusion[]> {
  return db.getAllAsync<PromptExclusion>('SELECT id, keyword FROM prompt_exclusions ORDER BY lower(keyword)');
}

export async function addPromptExclusion(db: SQLiteDatabase, keyword: string): Promise<void> {
  const k = keyword.trim();
  if (!k) return;
  const exists = await db.getFirstAsync('SELECT id FROM prompt_exclusions WHERE lower(keyword) = lower(?)', k);
  if (exists) return;
  await db.runAsync('INSERT INTO prompt_exclusions (id, keyword, created_at) VALUES (?, ?, ?)', newId(), k, new Date().toISOString());
}

export async function deletePromptExclusion(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('DELETE FROM prompt_exclusions WHERE id = ?', id);
}
