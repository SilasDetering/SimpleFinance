import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatDate } from '@/domain/dates';
import { formatCents } from '@/domain/money';
import { ACCOUNT_CASH, CATEGORY_CASH } from '@/domain/types';
import { deleteTransaction, setTransactionAlias, setTransactionNote } from '@/db/repo';
import { CategoryPicker } from '@/ui/CategoryPicker';
import { Button, CategoryBadge, Divider, Icon } from '@/ui/components';
import { useData } from '@/ui/DataProvider';
import { displayTitle } from '@/ui/TransactionRow';
import { font, radius, space, useTheme } from '@/ui/theme';
import { useCategoryChange } from '@/ui/useCategoryChange';

export default function TransactionDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useTheme();
  const db = useSQLiteContext();
  const { transactions, categories, categoryById, reload } = useData();
  const changeCategory = useCategoryChange();
  const tx = useMemo(() => transactions.find((x) => x.id === id), [transactions, id]);
  const [note, setNote] = useState(tx?.note ?? '');
  const [alias, setAlias] = useState(tx?.alias ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    setNote(tx?.note ?? '');
    setAlias(tx?.alias ?? '');
  }, [tx?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!tx) {
    return (
      <View style={styles.center}>
        <Text style={{ color: t.textMuted }}>Buchung nicht gefunden.</Text>
      </View>
    );
  }

  const category = tx.categoryId ? categoryById.get(tx.categoryId) : undefined;
  const isCash = tx.accountId === ACCOUNT_CASH;
  const saveNote = async () => {
    if ((tx.note ?? '') === note.trim()) return;
    await setTransactionNote(db, tx.id, note);
    await reload();
  };

  const saveAlias = async () => {
    if ((tx.alias ?? '') === alias.trim()) return;
    await setTransactionAlias(db, tx.id, alias);
    await reload();
  };

  const remove = () =>
    Alert.alert('Buchung löschen?', 'Die manuelle Bargeld-Buchung wird entfernt.', [
      { text: 'Abbrechen', style: 'cancel' },
      {
        text: 'Löschen',
        style: 'destructive',
        onPress: async () => {
          await deleteTransaction(db, tx.id);
          // Erst zurück, dann neu laden: sonst blitzt kurz „Buchung nicht gefunden" auf
          router.back();
          await reload();
        },
      },
    ]);

  const rows: [string, string][] = [
    ['Datum', formatDate(tx.bookingDate)],
    ...(tx.valueDate && tx.valueDate !== tx.bookingDate ? ([['Valuta', formatDate(tx.valueDate)]] as [string, string][]) : []),
    ...(tx.alias && tx.counterparty ? ([['Empfänger', tx.counterparty]] as [string, string][]) : []),
    ['Konto', isCash ? 'Bargeld-Kasse' : 'ING Girokonto'],
    ...(tx.bookingText ? ([['Buchungstext', tx.bookingText]] as [string, string][]) : []),
    ...(tx.purpose ? ([['Verwendungszweck', tx.purpose]] as [string, string][]) : []),
    ...(tx.balanceCents != null ? ([['Saldo danach', formatCents(tx.balanceCents)]] as [string, string][]) : []),
  ];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen
        options={{
          headerRight: isCash
            ? () => (
                <Pressable
                  onPress={() => router.push({ pathname: '/cash-entry', params: { id: tx.id } })}
                  hitSlop={8}
                >
                  <Text style={[font.bodyStrong, { color: t.accent }]}>Bearbeiten</Text>
                </Pressable>
              )
            : undefined,
        }}
      />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: space.sm, paddingTop: space.md }}>
          <CategoryBadge category={category} size={56} />
          <Text style={[font.h2, { color: t.text, textAlign: 'center' }]}>{displayTitle(tx)}</Text>
          {tx.alias && tx.counterparty ? (
            <Text style={[font.small, { color: t.textMuted, textAlign: 'center' }]}>{tx.counterparty}</Text>
          ) : null}
          <Text
            style={[
              font.title,
              { color: tx.amountCents > 0 ? t.income : t.text, fontVariant: ['tabular-nums'] },
            ]}
          >
            {formatCents(tx.amountCents, { sign: true })}
          </Text>
          {tx.categoryId === CATEGORY_CASH ? (
            <Text style={[font.small, { color: t.textMuted, textAlign: 'center' }]}>
              {tx.amountCents < 0
                ? 'Abhebung: füllt die Bargeld-Kasse auf und zählt nicht als Ausgabe.'
                : 'Bareinzahlung: verringert die Bargeld-Kasse und zählt nicht als Einnahme.'}
            </Text>
          ) : null}
        </View>

        <Pressable
          onPress={() => setPickerOpen(true)}
          style={({ pressed }) => [styles.categoryRow, { backgroundColor: t.surface, opacity: pressed ? 0.7 : 1 }]}
        >
          <Text style={[font.small, { color: t.textMuted }]}>Kategorie</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            {category ? <View style={[styles.dot, { backgroundColor: category.color }]} /> : null}
            <Text style={[font.bodyStrong, { color: category ? t.text : t.accent }]}>
              {category?.name ?? 'Kategorie wählen'}
            </Text>
            <Icon name="chevron-forward" size={16} color={t.textFaint} />
          </View>
        </Pressable>

        <View style={{ backgroundColor: t.surface, borderRadius: radius.lg, paddingHorizontal: space.lg }}>
          {rows.map(([label, value], i) => (
            <View key={label}>
              {i > 0 ? <Divider /> : null}
              <View style={styles.infoRow}>
                <Text style={[font.small, { color: t.textMuted }]}>{label}</Text>
                <Text style={[font.body, { color: t.text, flexShrink: 1, textAlign: 'right' }]} selectable>
                  {value}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {!isCash ? (
          <View style={{ gap: space.sm }}>
            <Text style={[font.caption, { color: t.textMuted, textTransform: 'uppercase' }]}>Eigener Name</Text>
            <TextInput
              value={alias}
              onChangeText={setAlias}
              onBlur={saveAlias}
              onSubmitEditing={saveAlias}
              placeholder="z. B. AldiTalk Flat"
              placeholderTextColor={t.textFaint}
              returnKeyType="done"
              style={[font.body, styles.input, styles.singleLine, { color: t.text, backgroundColor: t.surface }]}
            />
            <Text style={[font.small, { color: t.textMuted }]}>
              Wird statt „{tx.counterparty || 'Empfänger'}" angezeigt. Regeln prüfen den Namen mit, so lässt sich z. B. eine
              PayPal-Zahlung gezielt einer Kategorie zuordnen.
            </Text>
          </View>
        ) : null}

        <View style={{ gap: space.sm }}>
          <Text style={[font.caption, { color: t.textMuted, textTransform: 'uppercase' }]}>Notiz</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            onBlur={saveNote}
            onSubmitEditing={saveNote}
            placeholder="Notiz hinzufügen"
            placeholderTextColor={t.textFaint}
            multiline
            style={[font.body, styles.input, { color: t.text, backgroundColor: t.surface }]}
          />
        </View>

        {isCash ? <Button title="Buchung löschen" variant="secondary" icon="trash-outline" onPress={remove} /> : null}
      </ScrollView>

      <CategoryPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        categories={categories}
        selectedId={tx.categoryId}
        excludeCash={isCash}
        onSelect={(c) => changeCategory(tx, c)}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  categoryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: space.lg,
    borderRadius: radius.lg,
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', gap: space.lg, paddingVertical: space.md },
  input: { borderRadius: radius.md, padding: space.md, minHeight: 80, textAlignVertical: 'top' },
  singleLine: { minHeight: 0 },
});
