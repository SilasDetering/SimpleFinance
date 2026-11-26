import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { formatMonth } from '@/domain/dates';
import { formatCents } from '@/domain/money';
import { entriesForCategory, type Period } from '@/domain/stats';
import { ACCOUNT_CASH, CATEGORY_OTHER, type Transaction } from '@/domain/types';
import { CategoryPicker } from '@/ui/CategoryPicker';
import { CategoryBadge, Divider } from '@/ui/components';
import { useData } from '@/ui/DataProvider';
import { TransactionRow } from '@/ui/TransactionRow';
import { font, space, useTheme } from '@/ui/theme';
import { useCategoryChange } from '@/ui/useCategoryChange';

/** Einzelposten einer Kategorie im gewählten Zeitraum (aus den Auswertungen). */
export default function CategoryTransactionsScreen() {
  const { id, month } = useLocalSearchParams<{ id: string; month?: string }>();
  const t = useTheme();
  const { transactions, categories, categoryById, lookup } = useData();
  const changeCategory = useCategoryChange();
  const [pickerTx, setPickerTx] = useState<Transaction | null>(null);

  const period: Period = month && month !== 'all' ? { kind: 'month', month } : { kind: 'all' };
  const category = categoryById.get(id);
  const items = useMemo(() => entriesForCategory(transactions, lookup, id, period), [transactions, lookup, id, month]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = items.reduce((s, tx) => s + tx.amountCents, 0);
  const name = category?.name ?? (id === CATEGORY_OTHER ? 'Sonstiges' : 'Kategorie');

  return (
    <>
      <Stack.Screen options={{ title: name }} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl }}
        ListHeaderComponent={
          <View style={[styles.header, { borderBottomColor: t.border }]}>
            <CategoryBadge category={category} size={48} />
            <Text style={[font.title, { color: t.text, fontVariant: ['tabular-nums'] }]}>
              {formatCents(Math.abs(total))}
            </Text>
            <Text style={[font.small, { color: t.textMuted }]}>
              {period.kind === 'month' ? formatMonth(period.month) : 'Gesamter Zeitraum'} · {items.length}{' '}
              {items.length === 1 ? 'Buchung' : 'Buchungen'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TransactionRow
            tx={item}
            category={item.categoryId ? categoryById.get(item.categoryId) : undefined}
            onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: item.id } })}
            onPressCategory={() => setPickerTx(item)}
          />
        )}
        ItemSeparatorComponent={Divider}
        ListEmptyComponent={
          <Text style={[font.body, { color: t.textMuted, textAlign: 'center', paddingVertical: space.xxl }]}>
            Keine Buchungen in diesem Zeitraum.
          </Text>
        }
      />
      <CategoryPicker
        visible={!!pickerTx}
        onClose={() => setPickerTx(null)}
        categories={categories}
        selectedId={pickerTx?.categoryId}
        excludeCash={pickerTx?.accountId === ACCOUNT_CASH}
        onSelect={(c) => pickerTx && changeCategory(pickerTx, c)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    gap: space.xs,
    paddingTop: space.lg,
    paddingBottom: space.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
