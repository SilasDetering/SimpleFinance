import { useSQLiteContext } from 'expo-sqlite';
import { useCallback } from 'react';
import type { Category, Transaction } from '@/domain/types';
import { setTransactionCategory } from '@/db/repo';
import { useData } from './DataProvider';
import { useAskRule } from './RulePrompt';

/**
 * Ändert die Kategorie einer Buchung und fragt danach, ob daraus eine Regel
 * werden soll ("Lernen aus Korrekturen"). Das Stichwort ist dabei anpassbar.
 */
export function useCategoryChange() {
  const db = useSQLiteContext();
  const { reload } = useData();
  const askRule = useAskRule();

  return useCallback(
    async (tx: Transaction, category: Category) => {
      if (tx.categoryId === category.id && tx.categoryManual) return;
      await setTransactionCategory(db, tx.id, category.id);
      await reload();
      if (tx.source !== 'csv' || !tx.counterparty.trim()) return;
      // Kurz warten, bis die Kategorie-Auswahl geschlossen ist (zwei Modals gleichzeitig mag iOS nicht)
      setTimeout(() => askRule(tx, category), 350);
    },
    [db, reload, askRule],
  );
}
