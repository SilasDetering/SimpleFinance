import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { incomeExpense } from '@/domain/cash';
import { formatDate, formatMonth, monthKey } from '@/domain/dates';
import { CsvFormatError } from '@/domain/ingCsv';
import { formatCents } from '@/domain/money';
import { ACCOUNT_CASH, type Transaction } from '@/domain/types';
import { BottomSheet } from '@/ui/BottomSheet';
import { CategoryPicker } from '@/ui/CategoryPicker';
import { Button, Divider, Icon, ListRow } from '@/ui/components';
import { useData } from '@/ui/DataProvider';
import { pickAndImportCsv } from '@/ui/importCsv';
import { TransactionRow } from '@/ui/TransactionRow';
import { font, radius, space, useTheme } from '@/ui/theme';
import { useCategoryChange } from '@/ui/useCategoryChange';

interface Section {
  key: string;
  title: string;
  saldoCents: number;
  data: Transaction[];
}

export default function HistoryScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const { loading, transactions, categories, categoryById, lookup, bankBalance, reload } = useData();
  const changeCategory = useCategoryChange();
  const [onlyUncategorized, setOnlyUncategorized] = useState(false);
  const [pickerTx, setPickerTx] = useState<Transaction | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  const uncategorizedCount = useMemo(() => transactions.filter((tx) => !tx.categoryId).length, [transactions]);

  const sections = useMemo<Section[]>(() => {
    const byMonth = new Map<string, Transaction[]>();
    for (const tx of transactions) {
      const key = monthKey(tx.bookingDate);
      if (!byMonth.has(key)) byMonth.set(key, []);
      byMonth.get(key)!.push(tx);
    }
    return [...byMonth.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([key, txs]) => ({
        key,
        title: formatMonth(key),
        saldoCents: incomeExpense(txs, lookup).saldoCents,
        data: onlyUncategorized ? txs.filter((tx) => !tx.categoryId) : txs,
      }))
      .filter((s) => s.data.length > 0);
  }, [transactions, lookup, onlyUncategorized]);

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
              { text: 'Unkategorisierte zeigen', onPress: () => setOnlyUncategorized(true) },
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

      {uncategorizedCount > 0 || onlyUncategorized ? (
        <Pressable
          onPress={() => setOnlyUncategorized((v) => !v)}
          style={[
            styles.filter,
            {
              borderColor: onlyUncategorized ? t.text : t.border,
              backgroundColor: onlyUncategorized ? t.text : 'transparent',
            },
          ]}
        >
          <Icon name={onlyUncategorized ? 'close' : 'help-circle-outline'} size={14} color={onlyUncategorized ? t.bg : t.textMuted} />
          <Text style={[font.smallStrong, { color: onlyUncategorized ? t.bg : t.textMuted }]}>
            {onlyUncategorized ? 'Alle Buchungen zeigen' : `${uncategorizedCount} ohne Kategorie`}
          </Text>
        </Pressable>
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
            <Text
              style={[
                font.smallStrong,
                { color: section.saldoCents >= 0 ? t.income : t.textMuted, fontVariant: ['tabular-nums'] },
              ]}
            >
              Saldo {formatCents(section.saldoCents, { sign: true })}
            </Text>
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
              {onlyUncategorized
                ? 'Alle Buchungen sind kategorisiert.'
                : 'Importiere deine erste ING-CSV, um loszulegen.'}
            </Text>
            {!onlyUncategorized ? <Button title="CSV importieren" icon="download-outline" onPress={runImport} /> : null}
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
  filter: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: space.lg,
    paddingHorizontal: space.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
  monthHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingTop: space.xl,
    paddingBottom: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
