import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { incomeExpense } from '@/domain/cash';
import { formatDate, formatMonth, monthKey, todayIso } from '@/domain/dates';
import {
  activeFilterCount,
  EMPTY_FILTER,
  filterTransactions,
  isFilterActive,
  monthEndBalances,
  UNCATEGORIZED,
  type TransactionFilter,
} from '@/domain/filter';
import { CsvFormatError } from '@/domain/ingCsv';
import { formatCents } from '@/domain/money';
import { ACCOUNT_CASH, ACCOUNT_GIRO, type Transaction } from '@/domain/types';
import { BottomSheet } from '@/ui/BottomSheet';
import { CategoryPicker } from '@/ui/CategoryPicker';
import { Button, Divider, Icon, ListRow } from '@/ui/components';
import { useData } from '@/ui/DataProvider';
import { FilterSheet, KIND_LABEL, presetLabel } from '@/ui/FilterSheet';
import { pickAndImportCsv } from '@/ui/importCsv';
import { TransactionRow } from '@/ui/TransactionRow';
import { font, radius, space, useTheme } from '@/ui/theme';
import { useCategoryChange } from '@/ui/useCategoryChange';

interface Section {
  key: string;
  title: string;
  saldoCents: number;
  /** Kontostand (Bank) am Monatsende, falls bekannt */
  balanceCents: number | undefined;
  /** Summe der angezeigten Buchungen (bei aktivem Filter) */
  sumCents: number;
  data: Transaction[];
}

export default function HistoryScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const { loading, transactions, categories, categoryById, lookup, bankBalance, reload } = useData();
  const changeCategory = useCategoryChange();
  const [filter, setFilter] = useState<TransactionFilter>(EMPTY_FILTER);
  const [filterOpen, setFilterOpen] = useState(false);
  const [pickerTx, setPickerTx] = useState<Transaction | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const uncategorizedCount = useMemo(() => transactions.filter((tx) => !tx.categoryId).length, [transactions]);

  const filtering = isFilterActive(filter);
  const currentMonth = monthKey(todayIso());
  const months = useMemo(() => [...new Set(transactions.map((tx) => monthKey(tx.bookingDate)))].sort(), [transactions]);
  const balances = useMemo(() => monthEndBalances(transactions, ACCOUNT_GIRO), [transactions]);
  const visible = useMemo(
    () => filterTransactions(transactions, filter, lookup, currentMonth),
    [transactions, filter, lookup, currentMonth],
  );
  const visibleSum = useMemo(() => visible.reduce((s, tx) => s + tx.amountCents, 0), [visible]);

  const sections = useMemo<Section[]>(() => {
    const byMonth = new Map<string, Transaction[]>();
    for (const tx of transactions) {
      const key = monthKey(tx.bookingDate);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push(tx);
    }
    return [...byMonth.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, txs]) => {
        const data = filtering ? filterTransactions(txs, filter, lookup, currentMonth) : txs;
        return {
          key,
          title: formatMonth(key),
          saldoCents: incomeExpense(txs, lookup).saldoCents,
          balanceCents: balances.get(key),
          sumCents: data.reduce((sum, tx) => sum + tx.amountCents, 0),
          data,
        };
      })
      .filter((s) => s.data.length > 0);
  }, [transactions, lookup, filter, filtering, currentMonth, balances]);

  const filterSummary = [
    filter.kind !== 'all' ? KIND_LABEL[filter.kind] : null,
    filter.preset !== 'all' ? presetLabel(filter) : null,
    filter.categoryIds.length === 1
      ? filter.categoryIds[0] === UNCATEGORIZED
        ? 'Ohne Kategorie'
        : categoryById.get(filter.categoryIds[0])?.name
      : filter.categoryIds.length > 1
        ? `${filter.categoryIds.length} Kategorien`
        : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const runImport = useCallback(async () => {
    setMenuOpen(false);
    setImporting(true);
    try {
      const summary = await pickAndImportCsv(db);
      if (!summary) return;
      await reload();
      const lines = [
        `${summary.newCount} neu`,
        `${summary.duplicateCount} Duplikate übersprungen`,
        `${summary.uncategorizedCount} nicht kategorisiert`,
      ];
      if (summary.errorCount) lines.push(`${summary.errorCount} Zeilen nicht lesbar`);
      Alert.alert(
        'Import abgeschlossen',
        lines.join('\n'),
        summary.uncategorizedCount > 0
          ? [
              { text: 'OK', style: 'cancel' },
              { text: 'Unkategorisierte zeigen', onPress: () => setFilter({ ...EMPTY_FILTER, categoryIds: [UNCATEGORIZED] }) },
            ]
          : [{ text: 'OK' }],
      );
    } catch (e) {
      Alert.alert(
        'Import fehlgeschlagen',
        e instanceof CsvFormatError ? e.message : `Die Datei konnte nicht gelesen werden.\n\n${String(e)}`,
      );
    } finally {
      setImporting(false);
    }
  }, [db, reload]);

  const openCashEntry = (kind: 'expense' | 'income') => {
    setMenuOpen(false);
    router.push({ pathname: '/cash-entry', params: { kind } });
  };

  const header = (
    <View style={{ paddingTop: space.lg, paddingBottom: space.md }}>
      <View style={styles.topBar}>
        <Text style={[font.small, { color: t.textMuted }]}>Kontostand · ING Girokonto</Text>
        <Pressable
          onPress={() => setMenuOpen(true)}
          style={({ pressed }) => [styles.addBtn, { backgroundColor: t.text, opacity: pressed ? 0.8 : 1 }]}
          accessibilityLabel="Hinzufügen"
          hitSlop={8}
        >
          <Icon name="add" size={22} color={t.bg} />
        </Pressable>
      </View>
      <Text style={[font.hero, { color: t.text, fontVariant: ['tabular-nums'] }]}>
        {bankBalance ? formatCents(bankBalance.cents) : '–'}
      </Text>
      <Text style={[font.small, { color: t.textFaint, marginTop: 2 }]}>
        {bankBalance ? `Stand ${formatDate(bankBalance.asOf)}` : 'Noch keine Daten importiert'}
      </Text>

      {transactions.length > 0 ? (
        <View style={styles.filterBar}>
          <Pressable
            onPress={() => setFilterOpen(true)}
            style={[
              styles.filter,
              { borderColor: filtering ? t.text : t.border, backgroundColor: filtering ? t.text : 'transparent' },
            ]}
            accessibilityLabel="Filter"
          >
            <Icon name="options-outline" size={14} color={filtering ? t.bg : t.textMuted} />
            <Text style={[font.smallStrong, { color: filtering ? t.bg : t.textMuted }]}>
              {filtering ? `Filter (${activeFilterCount(filter)})` : 'Filter'}
            </Text>
          </Pressable>
          {filtering ? (
            <Pressable
              onPress={() => setFilter(EMPTY_FILTER)}
              style={[styles.filter, { borderColor: t.border }]}
              accessibilityLabel="Filter zurücksetzen"
            >
              <Icon name="close" size={14} color={t.textMuted} />
              <Text style={[font.smallStrong, { color: t.textMuted }]}>Zurücksetzen</Text>
            </Pressable>
          ) : uncategorizedCount > 0 ? (
            <Pressable
              onPress={() => setFilter({ ...EMPTY_FILTER, categoryIds: [UNCATEGORIZED] })}
              style={[styles.filter, { borderColor: t.border }]}
            >
              <Icon name="help-circle-outline" size={14} color={t.textMuted} />
              <Text style={[font.smallStrong, { color: t.textMuted }]}>{uncategorizedCount} ohne Kategorie</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {filtering ? (
        <View style={[styles.filterInfo, { backgroundColor: t.surface }]}>
          <Text style={[font.small, { color: t.textMuted, flex: 1 }]} numberOfLines={2}>
            {filterSummary} · {visible.length} {visible.length === 1 ? 'Buchung' : 'Buchungen'}
          </Text>
          <Text style={[font.smallStrong, { color: visibleSum > 0 ? t.income : t.text, fontVariant: ['tabular-nums'] }]}>
            {formatCents(visibleSum, { sign: true })}
          </Text>
        </View>
      ) : null}
    </View>
  );

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl }}
        ListHeaderComponent={header}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <View style={[styles.monthHeader, { borderBottomColor: t.border }]}>
            <Text style={[font.h2, { color: t.text }]}>{section.title}</Text>
            {filtering ? (
              <Text style={[font.smallStrong, { color: t.textMuted, fontVariant: ['tabular-nums'] }]}>
                Summe {formatCents(section.sumCents, { sign: true })}
              </Text>
            ) : (
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Text
                  style={[
                    font.smallStrong,
                    { color: section.saldoCents >= 0 ? t.income : t.textMuted, fontVariant: ['tabular-nums'] },
                  ]}
                >
                  Saldo {formatCents(section.saldoCents, { sign: true })}
                </Text>
                {section.balanceCents !== undefined ? (
                  <Text style={[font.small, { color: t.textFaint, fontVariant: ['tabular-nums'] }]}>
                    Kontostand {formatCents(section.balanceCents)}
                  </Text>
                ) : null}
              </View>
            )}
          </View>
        )}
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
          <View style={{ paddingVertical: space.xxl, gap: space.lg }}>
            <Text style={[font.body, { color: t.textMuted, textAlign: 'center' }]}>
              {filtering
                ? 'Keine Buchungen für diesen Filter.'
                : 'Importiere deine erste ING-CSV, um loszulegen.'}
            </Text>
            {!filtering ? <Button title="CSV importieren" icon="download-outline" onPress={runImport} /> : null}
          </View>
        }
      />

      <BottomSheet visible={menuOpen} onClose={() => setMenuOpen(false)} title="Hinzufügen">
        <ListRow
          title="Neuen Monat importieren"
          subtitle="CSV-Export aus der ING-App"
          left={<MenuIcon name="download-outline" />}
          onPress={runImport}
        />
        <Divider />
        <ListRow
          title="Bar-Ausgabe"
          subtitle="z. B. 8 € beim Bäcker"
          left={<MenuIcon name="remove-circle-outline" />}
          onPress={() => openCashEntry('expense')}
        />
        <Divider />
        <ListRow
          title="Bargeld erhalten"
          subtitle="z. B. Geschenk oder Verkauf"
          left={<MenuIcon name="add-circle-outline" />}
          onPress={() => openCashEntry('income')}
        />
      </BottomSheet>

      <FilterSheet
        visible={filterOpen}
        onClose={() => setFilterOpen(false)}
        value={filter}
        onApply={setFilter}
        categories={categories}
        firstMonth={months[0] ?? currentMonth}
        lastMonth={months[months.length - 1] ?? currentMonth}
      />

      <CategoryPicker
        visible={!!pickerTx}
        onClose={() => setPickerTx(null)}
        categories={categories}
        selectedId={pickerTx?.categoryId}
        excludeCash={pickerTx?.accountId === ACCOUNT_CASH}
        onSelect={(c) => pickerTx && changeCategory(pickerTx, c)}
      />

      {importing ? (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: t.overlay }]}>
          <ActivityIndicator color="#fff" size="large" />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

function MenuIcon({ name }: { name: string }) {
  const t = useTheme();
  return (
    <View style={[styles.menuIcon, { backgroundColor: t.surface }]}>
      <Icon name={name} size={20} color={t.text} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.xs },
  addBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  filterBar: { flexDirection: 'row', gap: space.sm, marginTop: space.lg },
  filterInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingTop: space.xl,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
