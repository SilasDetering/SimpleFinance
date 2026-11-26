import { useSQLiteContext } from 'expo-sqlite';
import { useCallback } from 'react';
import { Alert } from 'react-native';
import { suggestKeyword } from '@/domain/categorize';
import type { Category, Transaction } from '@/domain/types';
import { countSameCounterparty, learnRuleFromCorrection, setTransactionCategory } from '@/db/repo';
import { useData } from './DataProvider';

/**
 * Ändert die Kategorie einer Buchung und fragt danach, ob daraus eine Regel
 * für diesen Empfänger werden soll ("Lernen aus Korrekturen").
 */
export function useCategoryChange() {
  const db = useSQLiteContext();
  const { reload } = useData();

  return useCallback(
    async (tx: Transaction, category: Category) => {
      if (tx.categoryId === category.id && tx.categoryManual) return;
      await setTransactionCategory(db, tx.id, category.id);
      await reload();

      const counterparty = tx.counterparty.trim();
      if (tx.source !== 'csv' || !counterparty) return;
      const others = await countSameCounterparty(db, counterparty, tx.id);
      const keyword = suggestKeyword(counterparty);
      Alert.alert(
        'Regel anlegen?',
        `Sollen Buchungen von „${keyword}" künftig automatisch in „${category.name}" landen?` +
          (others > 0 ? `\n\n${others} weitere ${others === 1 ? 'Buchung wird' : 'Buchungen werden'} ebenfalls angepasst.` : ''),
        [
          { text: 'Nur diese', style: 'cancel' },
          {
            text: 'Regel anlegen',
            onPress: async () => {
              await learnRuleFromCorrection(db, keyword, category.id);
              await reload();
            },
          },
        ],
      );
    },
    [db, reload],
  );
}
