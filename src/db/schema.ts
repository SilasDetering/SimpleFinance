import type { SQLiteDatabase } from 'expo-sqlite';
import { DEFAULT_CATEGORIES } from '@/domain/defaults';
import { ACCOUNT_CASH, ACCOUNT_GIRO } from '@/domain/types';
import { newId } from './id';

/**
 * Datenbank-Schema und Migrationen. Die Version steht in PRAGMA user_version.
 * Neue Migrationen einfach unten an MIGRATIONS anhängen.
 */

const MIGRATIONS: ((db: SQLiteDatabase) => Promise<void>)[] = [
  // v1: Grundschema + Default-Daten
  async (db) => {
    await db.execAsync(`
      CREATE TABLE accounts (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        iban TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE categories (
        id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL,
        icon TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('expense', 'income', 'transfer')),
        is_system INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE rules (
        id TEXT PRIMARY KEY NOT NULL,
        category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        keyword TEXT NOT NULL,
        field TEXT NOT NULL DEFAULT 'any',
        priority INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_rules_category ON rules(category_id);

      CREATE TABLE imports (
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        file_name TEXT,
        period_from TEXT,
        period_to TEXT,
        balance_cents INTEGER,
        new_count INTEGER NOT NULL DEFAULT 0,
        duplicate_count INTEGER NOT NULL DEFAULT 0,
        imported_at TEXT NOT NULL
      );

      CREATE TABLE transactions (
        id TEXT PRIMARY KEY NOT NULL,
        account_id TEXT NOT NULL REFERENCES accounts(id),
        booking_date TEXT NOT NULL,
        value_date TEXT,
        counterparty TEXT NOT NULL DEFAULT '',
        booking_text TEXT NOT NULL DEFAULT '',
        purpose TEXT NOT NULL DEFAULT '',
        amount_cents INTEGER NOT NULL,
        balance_cents INTEGER,
        category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
        category_manual INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        source TEXT NOT NULL,
        import_id TEXT REFERENCES imports(id) ON DELETE SET NULL,
        dedup_key TEXT UNIQUE,
        day_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_tx_date ON transactions(booking_date DESC, day_order DESC);
      CREATE INDEX idx_tx_account ON transactions(account_id);
      CREATE INDEX idx_tx_category ON transactions(category_id);
    `);

    await db.runAsync(
      'INSERT INTO accounts (id, name, type, iban, sort_order) VALUES (?, ?, ?, ?, ?), (?, ?, ?, ?, ?)',
      ACCOUNT_GIRO, 'ING Girokonto', 'giro', null, 0,
      ACCOUNT_CASH, 'Bargeld', 'cash', null, 99,
    );
    await seedDefaultCategories(db);
  },
  // v2: Sparschwein-Symbol für "Umbuchungen/Sparen" (nur wenn das Icon noch nicht geändert wurde)
  async (db) => {
    await db.runAsync(
      "UPDATE categories SET icon = 'mci:piggy-bank-outline' WHERE id = 'transfer' AND icon = 'swap-horizontal-outline'",
    );
  },
];

export async function seedDefaultCategories(db: SQLiteDatabase): Promise<void> {
  const now = new Date().toISOString();
  let order = 0;
  for (const c of DEFAULT_CATEGORIES) {
    await db.runAsync(
      'INSERT OR IGNORE INTO categories (id, name, color, icon, type, is_system, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      c.id, c.name, c.color, c.icon, c.type, c.isSystem ? 1 : 0, order++,
    );
    for (const keyword of c.keywords) {
      await db.runAsync(
        'INSERT INTO rules (id, category_id, keyword, field, priority, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        newId(), c.id, keyword, c.field ?? 'any', c.priority ?? 0, now,
      );
    }
  }
}

export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  while (version < MIGRATIONS.length) {
    const step = MIGRATIONS[version];
    await db.withTransactionAsync(async () => {
      await step(db);
    });
    version++;
    await db.execAsync(`PRAGMA user_version = ${version}`);
  }
}

export const SCHEMA_VERSION = MIGRATIONS.length;
