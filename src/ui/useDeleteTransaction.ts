import { useSQLiteContext } from 'expo-sqlite';
import { useCallback } from 'react';
import { Alert } from 'react-native';
import type { Transaction } from '@/domain/types';
import { deleteTransaction } from '@/db/repo';
import { useData } from './DataProvider';
import { displayTitle } from './TransactionRow';

/**
 * Fragt nach und löscht dann eine einzelne Buchung.
 * `onDeleted` läuft vor dem Neuladen (z. B. router.back() in der Detailansicht),
 * `onCancel` wenn abgebrochen wird (z. B. die Zeile wieder zuklappen).
 */
export function useDeleteTransaction() {
  const db = useSQLiteContext();
  const { reload } = useData();

  return useCallback(
    (tx: Transaction, opts?: { onDeleted?: () => void; onCancel?: () => void }) => {
      const message =
        tx.source === 'csv'
          ? `„${displayTitle(tx)}" wird entfernt und beim nächsten CSV-Import nicht wieder angelegt.`
          : `„${displayTitle(tx)}" wird entfernt.`;
      Alert.alert('Buchung löschen?', message, [
        { text: 'Abbrechen', style: 'cancel', onPress: opts?.onCancel },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: async () => {
            await deleteTransaction(db, tx.id);
            opts?.onDeleted?.();
            await reload();
          },
        },
      ]);
    },
    [db, reload],
  );
}
