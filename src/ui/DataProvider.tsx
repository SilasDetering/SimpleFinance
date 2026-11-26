import { useSQLiteContext } from 'expo-sqlite';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { cashBalance, toLookup, type CategoryLookup } from '@/domain/cash';
import { ACCOUNT_GIRO, type Category, type Rule, type Transaction } from '@/domain/types';
import { getBankBalance, getCategories, getRules, getTransactions } from '@/db/repo';

/**
 * Hält alle Daten im Speicher. Für ein privates Haushaltsbuch (einige tausend Buchungen)
 * ist das einfach und schnell; Auswertungen werden in reinem TS berechnet.
 */
interface DataState {
  loading: boolean;
  transactions: Transaction[];
  categories: Category[];
  categoryById: Map<string, Category>;
  lookup: CategoryLookup;
  rules: Rule[];
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
  const [bankBalance, setBankBalance] = useState<DataState['bankBalance']>(null);

  const reload = useCallback(async () => {
    const [tx, cats, rs, bal] = await Promise.all([
      getTransactions(db),
      getCategories(db),
      getRules(db),
      getBankBalance(db, ACCOUNT_GIRO),
    ]);
    setTransactions(tx);
    setCategories(cats);
    setRules(rs);
    setBankBalance(bal);
    setLoading(false);
  }, [db]);

  useEffect(() => {
    reload();
  }, [reload]);

  const value = useMemo<DataState>(() => {
    const categoryById = new Map(categories.map((c) => [c.id, c]));
    return {
      loading,
      transactions,
      categories,
      categoryById,
      lookup: toLookup(categories),
      rules,
      bankBalance,
      cashBalanceCents: cashBalance(transactions),
      reload,
    };
  }, [loading, transactions, categories, rules, bankBalance, reload]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataState {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData muss innerhalb von DataProvider verwendet werden');
  return ctx;
}
