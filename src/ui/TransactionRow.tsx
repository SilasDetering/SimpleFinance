import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { formatDayShort } from '@/domain/dates';
import { ACCOUNT_CASH, CATEGORY_CASH, type Category, type Transaction } from '@/domain/types';
import { Amount, CategoryBadge, CategoryChip } from './components';
import { SwipeToDelete } from './SwipeToDelete';
import { font, radius, space, useTheme } from './theme';

/** Anzeigename einer Buchung: eigener Name (Alias), sonst Empfänger, sonst Verwendungszweck/Buchungstext. */
export function displayTitle(tx: Transaction): string {
  return tx.alias || tx.counterparty || tx.purpose || tx.bookingText || 'Buchung';
}

/**
 * Eine Zeile im Verlauf: Kategorie-Icon, Empfänger, Kategorie-Chip (antippbar zum
 * direkten Ändern), Betrag und Datum. Bargeld-Buchungen sind dezent als "Bar" markiert.
 * Mit `onDelete` lässt sich die Zeile nach links wischen, um sie zu löschen.
 */
export const TransactionRow = memo(function TransactionRow({
  tx,
  category,
  onPress,
  onPressCategory,
  onDelete,
}: {
  tx: Transaction;
  category: Category | undefined;
  /** Bekommt die Buchung übergeben, damit die Liste stabile Callbacks reichen kann (memo greift) */
  onPress: (tx: Transaction) => void;
  onPressCategory: (tx: Transaction) => void;
  /** Bekommt eine Funktion zum Zuklappen der Zeile mit (z. B. wenn die Rückfrage abgebrochen wird) */
  onDelete?: (tx: Transaction, close: () => void) => void;
}) {
  const t = useTheme();
  const isCash = tx.accountId === ACCOUNT_CASH;
  // Umbuchungen und Bargeld-Bewegungen zählen nicht als Ein-/Ausgabe -> dezent darstellen
  const isTransfer = tx.categoryId === CATEGORY_CASH || category?.type === 'transfer';
  const row = (
    <Pressable onPress={() => onPress(tx)} style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}>
      <CategoryBadge category={category} />
      <View style={styles.middle}>
        <Text style={[font.body, { color: t.text }]} numberOfLines={1}>
          {displayTitle(tx)}
        </Text>
        <View style={styles.meta}>
          <CategoryChip category={category} onPress={() => onPressCategory(tx)} />
          {isCash ? (
            <View style={[styles.tag, { borderColor: t.border }]}>
              <Text style={[font.caption, { color: t.textMuted }]}>Bar</Text>
            </View>
          ) : null}
        </View>
      </View>
      <View style={styles.right}>
        <Amount
          cents={tx.amountCents}
          style={isTransfer ? { color: t.textMuted, fontWeight: '500' } : undefined}
        />
        <Text style={[font.small, { color: t.textFaint }]}>{formatDayShort(tx.bookingDate)}</Text>
      </View>
    </Pressable>
  );
  return onDelete ? <SwipeToDelete onDelete={(close) => onDelete(tx, close)}>{row}</SwipeToDelete> : row;
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  middle: { flex: 1, gap: 6 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  right: { alignItems: 'flex-end', gap: 4 },
  tag: { borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 6, paddingVertical: 1 },
});
