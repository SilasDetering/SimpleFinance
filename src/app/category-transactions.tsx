import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { BarChart } from 'react-native-gifted-charts';
import { formatMonth, formatMonthShort } from '@/domain/dates';
import { formatCents, formatCentsShort } from '@/domain/money';
import { categoryMonthlySeries, entriesForCategory, type Period } from '@/domain/stats';
import { ACCOUNT_CASH, CATEGORY_OTHER, type Transaction } from '@/domain/types';
import { CategoryPicker } from '@/ui/CategoryPicker';
import { Card, CategoryBadge, Divider, SectionTitle } from '@/ui/components';
import { useData } from '@/ui/DataProvider';
import { TransactionRow } from '@/ui/TransactionRow';
import { font, space, useTheme } from '@/ui/theme';
import { useCategoryChange } from '@/ui/useCategoryChange';

/** Einzelposten einer Kategorie im gewählten Zeitraum (aus den Auswertungen). */
export default function CategoryTransactionsScreen() {
  const { id, month } = useLocalSearchParams<{ id: string; month?: string }>();
  const t = useTheme();
  const { ledger: transactions, categories, categoryById, lookup } = useData();
  const changeCategory = useCategoryChange();
  const [pickerTx, setPickerTx] = useState<Transaction | null>(null);

  const period: Period = month && month !== 'all' ? { kind: 'month', month } : { kind: 'all' };
  const category = categoryById.get(id);
  const items = useMemo(() => entriesForCategory(transactions, lookup, id, period), [transactions, lookup, id, month]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = items.reduce((s, tx) => s + tx.amountCents, 0);
  const name = category?.name ?? (id === CATEGORY_OTHER ? 'Sonstiges' : 'Kategorie');

  // Monatsverlauf: so viele Monate wie Daten vorhanden, höchstens 12
  const { width } = useWindowDimensions();
  const series = useMemo(() => categoryMonthlySeries(transactions, lookup, id, 12), [transactions, lookup, id]);
  const average = series.length ? Math.round(series.reduce((s, m) => s + m.cents, 0) / series.length) : 0;
  const color = category?.color ?? t.textMuted;
  const chartWidth = width - space.lg * 4 - 40;
  const spacing = series.length > 8 ? 6 : 12;
  const barWidth = Math.max(6, Math.min(32, Math.floor((chartWidth - spacing * (series.length + 1)) / Math.max(series.length, 1))));
  // Runde Achsenwerte (1, 2, 5 × 10ⁿ) statt krummer Zahlen
  const peak = Math.max(1, ...series.map((m) => m.cents / 100));
  const rawStep = peak / 3;
  const mag = 10 ** Math.floor(Math.log10(rawStep));
  const stepValue = ([1, 2, 5, 10].find((f) => f * mag >= rawStep) ?? 10) * mag;
  const sections = Math.max(1, Math.ceil(peak / stepValue));
  const openTransaction = useCallback(
    (tx: Transaction) => router.push({ pathname: '/transaction/[id]', params: { id: tx.id } }),
    [],
  );
  const renderItem = useCallback(
    ({ item }: { item: Transaction }) => (
      <TransactionRow
        tx={item}
        category={item.categoryId ? categoryById.get(item.categoryId) : undefined}
        onPress={openTransaction}
        onPressCategory={setPickerTx}
      />
    ),
    [categoryById, openTransaction],
  );

  const barData = series.map((m) => ({
    value: Math.max(0, m.cents) / 100,
    label: formatMonthShort(m.month),
    frontColor: period.kind === 'all' || m.month === month ? color : `${color}55`,
    onPress: () => router.setParams({ month: m.month }),
  }));

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
            {series.length > 1 ? (
              <Card style={{ alignSelf: 'stretch', marginTop: space.md }}>
                <SectionTitle>Verlauf</SectionTitle>
                <BarChart
                  data={barData}
                  barWidth={barWidth}
                  spacing={spacing}
                  initialSpacing={spacing}
                  width={chartWidth}
                  height={140}
                  noOfSections={sections}
                  stepValue={stepValue}
                  maxValue={stepValue * sections}
                  barBorderRadius={3}
                  yAxisThickness={0}
                  xAxisThickness={0}
                  rulesColor={t.border}
                  yAxisTextStyle={{ color: t.textFaint, fontSize: 10 }}
                  xAxisLabelTextStyle={{ color: t.textFaint, fontSize: 10 }}
                  formatYLabel={(l: string) => formatCentsShort(Number(l) * 100).replace(' €', '')}
                  yAxisLabelWidth={40}
                  disableScroll
                  isAnimated={false}
                />
                <Text style={[font.small, { color: t.textMuted, marginTop: space.sm }]}>
                  Ø {formatCents(average)} pro Monat · letzte {series.length} Monate. Balken antippen, um den Monat zu wählen.
                </Text>
              </Card>
            ) : null}
          </View>
        }
        renderItem={renderItem}
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
