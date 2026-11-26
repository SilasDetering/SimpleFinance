import { useSQLiteContext } from 'expo-sqlite';
import { useCallback } from 'react';
import { isPromptExcluded } from '@/domain/categorize';
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
  const { reload, promptExclusions } = useData();
  const askRule = useAskRule();

  return useCallback(
    async (tx: Transaction, category: Category) => {
      if (tx.categoryId === category.id && tx.categoryManual) return;
      await setTransactionCategory(db, tx.id, category.id);
      await reload();
      if (tx.source !== 'csv' || !tx.counterparty.trim()) return;
      // Für ausgenommene Empfänger (z. B. PayPal) nicht nachfragen –
      // außer die Buchung hat einen eigenen Namen, dann lohnt sich eine Regel darauf
      if (!tx.alias && isPromptExcluded(tx.counterparty, promptExclusions)) return;
      // Das Sheet erscheint erst, wenn die Kategorie-Auswahl ganz zugeklappt ist (siehe RulePrompt)
      askRule(tx, category);
    },
    [db, reload, askRule, promptExclusions],
  );
}
