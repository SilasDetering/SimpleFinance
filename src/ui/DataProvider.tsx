import { useSQLiteContext } from 'expo-sqlite';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { cashBalance, toLookup, type CategoryLookup } from '@/domain/cash';
import { ACCOUNT_GIRO, type Category, type Rule, type Transaction } from '@/domain/types';
import type { PromptExclusion } from '@/domain/categorize';
import { applyReimbursements, openReimbursements, reimbursements, type Reimbursement } from '@/domain/reimburse';
import { getBankBalance, getCategories, getPromptExclusions, getRules, getTransactions } from '@/db/repo';

/**
 * Hält alle Daten im Speicher. Für ein privates Haushaltsbuch (einige tausend Buchungen)
 * ist das einfach und schnell; Auswertungen werden in reinem TS berechnet.
 */
interface DataState {
  loading: boolean;
  /** Alle Buchungen, wie sie auf dem Konto stehen (Liste, Kontostand, Kasse) */
  transactions: Transaction[];
  /**
   * Buchungen für Budget und Auswertungen: offene Erstattungen und zugeordnete Rückzahlungen
   * fallen weg, abgeschlossene Erstattungen zählen nur mit dem selbst getragenen Rest.
   */
  ledger: Transaction[];
  /** Erstattbare Ausgaben mit ihren Rückzahlungen, nach Ausgabe-ID */
  reimbursementById: Map<string, Reimbursement>;
  /** Noch offene Erstattungen, älteste zuerst */
  openReimbursements: Reimbursement[];
  categories: Category[];
  categoryById: Map<string, Category>;
  lookup: CategoryLookup;
  rules: Rule[];
  /** Empfänger, bei denen nicht nach einer Regel gefragt wird */
  promptExclusions: PromptExclusion[];
  bankBalance: { cents: number; asOf: string } | null;
  cashBalanceCents: number;
  reload: () => Promise<void>;
}

const DataContext = createContext<DataState | null>(null);

export function DataProvider({ children }: { children: React.ReactNode }) {
  const db = useSQLiteContext();
  const [loading, setLoading] = useState(true);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [promptExclusions, setPromptExclusions] = useState<PromptExclusion[]>([]);
  const [bankBalance, setBankBalance] = useState<DataState['bankBalance']>(null);

  // Laufen zwei Ladevorgänge gleichzeitig (z. B. Kategorie geändert und direkt Regel angelegt),
  // darf der ältere nicht nach dem neueren fertig werden und frische Daten überschreiben
  const latestLoad = useRef(0);

  const reload = useCallback(async () => {
    const load = ++latestLoad.current;
    const [tx, cats, rs, bal, excl] = await Promise.all([
      getTransactions(db),
      getCategories(db),
      getRules(db),
      getBankBalance(db, ACCOUNT_GIRO),
      getPromptExclusions(db),
    ]);
    if (load !== latestLoad.current) return;
    setPromptExclusions(excl);
    setTransactions(tx);
    setCategories(cats);
    setRules(rs);
    setBankBalance(bal);
    setLoading(false);
  }, [db]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Getrennt memoisiert: Ändern sich nur Buchungen, bleiben Kategorie-Map und Lookup dieselben Objekte
  const categoryById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const lookup = useMemo(() => toLookup(categories), [categories]);
  const cashBalanceCents = useMemo(() => cashBalance(transactions), [transactions]);
  const reimbursementById = useMemo(() => reimbursements(transactions), [transactions]);
  const ledger = useMemo(() => applyReimbursements(transactions, reimbursementById), [transactions, reimbursementById]);
  const open = useMemo(() => openReimbursements(reimbursementById), [reimbursementById]);

  const value = useMemo<DataState>(
    () => ({
      loading,
      transactions,
      ledger,
      reimbursementById,
      openReimbursements: open,
      categories,
      categoryById,
      lookup,
      rules,
      promptExclusions,
      bankBalance,
      cashBalanceCents,
      reload,
    }),
    [loading, transactions, ledger, reimbursementById, open, categories, categoryById, lookup, rules, promptExclusions, bankBalance, cashBalanceCents, reload],
  );

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataState {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData muss innerhalb von DataProvider verwendet werden');
  return ctx;
}
