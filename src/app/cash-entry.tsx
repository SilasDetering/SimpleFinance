import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatDate, parseGermanDate, todayIso } from '@/domain/dates';
import { formatCents, parseGermanAmount } from '@/domain/money';
import { CATEGORY_INCOME, CATEGORY_OTHER, type CategoryType } from '@/domain/types';
import { addManualCash } from '@/db/repo';
import { CategoryPicker } from '@/ui/CategoryPicker';
import { Button, CategoryBadge, Icon } from '@/ui/components';
import { useData } from '@/ui/DataProvider';
import { font, radius, space, useTheme } from '@/ui/theme';

/** Manuelle Bargeld-Buchung: Bar-Ausgabe oder Bargeld erhalten. */
export default function CashEntryScreen() {
  const params = useLocalSearchParams<{ kind?: 'expense' | 'income'; id?: string }>();
  const t = useTheme();
  const db = useSQLiteContext();
  const { transactions, categories, categoryById, cashBalanceCents, reload } = useData();
  const existing = params.id ? transactions.find((x) => x.id === params.id) : undefined;

  const [kind, setKind] = useState<'expense' | 'income'>(
    existing ? (existing.amountCents < 0 ? 'expense' : 'income') : params.kind === 'income' ? 'income' : 'expense',
  );
  const [amount, setAmount] = useState(existing ? formatCents(Math.abs(existing.amountCents), { currency: false }) : '');
  const [date, setDate] = useState(formatDate(existing?.bookingDate ?? todayIso()));
  const [description, setDescription] = useState(existing?.counterparty ?? '');
  const [categoryId, setCategoryId] = useState<string>(
    existing?.categoryId ?? (kind === 'income' ? CATEGORY_INCOME : CATEGORY_OTHER),
  );
  const [pickerOpen, setPickerOpen] = useState(false);

  const allowTypes: CategoryType[] = kind === 'expense' ? ['expense'] : ['income'];
  const category = categoryById.get(categoryId);
  const amountCents = parseGermanAmount(amount);
  const isoDate = parseGermanDate(date);
  const valid = !!amountCents && amountCents > 0 && !!isoDate && !!category && allowTypes.includes(category.type);

  const preview = useMemo(() => {
    if (!amountCents) return null;
    const delta = (kind === 'expense' ? -1 : 1) * Math.abs(amountCents) - (existing?.amountCents ?? 0);
    return cashBalanceCents + delta;
  }, [amountCents, kind, cashBalanceCents, existing]);

  const switchKind = (k: 'expense' | 'income') => {
    setKind(k);
    const cat = categoryById.get(categoryId);
    if (!cat || cat.type !== k) setCategoryId(k === 'income' ? CATEGORY_INCOME : CATEGORY_OTHER);
  };

  const save = async () => {
    if (!valid) return;
    try {
      await addManualCash(
        db,
        { kind, amountCents: amountCents!, bookingDate: isoDate!, categoryId, description: description || category!.name },
        existing?.id,
      );
      await reload();
      router.back();
    } catch (e) {
      Alert.alert('Speichern fehlgeschlagen', String(e));
    }
  };

  const yesterday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return formatDate(todayIso(d));
  })();

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: existing ? 'Bargeld-Buchung' : kind === 'expense' ? 'Bar-Ausgabe' : 'Bargeld erhalten' }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }} keyboardShouldPersistTaps="handled">
        <View style={[styles.segment, { backgroundColor: t.surface }]}>
          {(['expense', 'income'] as const).map((k) => (
            <Pressable
              key={k}
              onPress={() => switchKind(k)}
              style={[styles.segmentItem, kind === k && { backgroundColor: t.bg }]}
            >
              <Text style={[font.smallStrong, { color: kind === k ? t.text : t.textMuted }]}>
                {k === 'expense' ? 'Ausgabe' : 'Erhalten'}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={{ alignItems: 'center' }}>
          <View style={styles.amountRow}>
            <Text style={[font.title, { color: t.textFaint }]}>{kind === 'expense' ? '−' : '+'}</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              placeholder="0,00"
              placeholderTextColor={t.textFaint}
              keyboardType="decimal-pad"
              autoFocus={!existing}
              style={[font.hero, { color: t.text, minWidth: 120, textAlign: 'center', fontVariant: ['tabular-nums'] }]}
            />
            <Text style={[font.title, { color: t.textFaint }]}>€</Text>
          </View>
          {preview !== null ? (
            <Text style={[font.small, { color: preview < 0 ? t.warning : t.textMuted }]}>
              Bargeld danach: {formatCents(preview)}
            </Text>
          ) : null}
        </View>

        <Field label="Beschreibung">
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder={kind === 'expense' ? 'z. B. Bäcker' : 'z. B. Geburtstagsgeschenk'}
            placeholderTextColor={t.textFaint}
            style={[font.body, styles.input, { color: t.text, backgroundColor: t.surface }]}
          />
        </Field>

        <Field label="Kategorie">
          <Pressable
            onPress={() => setPickerOpen(true)}
            style={({ pressed }) => [styles.input, styles.pickRow, { backgroundColor: t.surface, opacity: pressed ? 0.7 : 1 }]}
          >
            <CategoryBadge category={category} size={28} />
            <Text style={[font.body, { color: t.text, flex: 1 }]}>{category?.name ?? 'Kategorie wählen'}</Text>
            <Icon name="chevron-forward" size={16} color={t.textFaint} />
          </Pressable>
        </Field>

        <Field label="Datum">
          <TextInput
            value={date}
            onChangeText={setDate}
            placeholder="TT.MM.JJJJ"
            placeholderTextColor={t.textFaint}
            keyboardType="numbers-and-punctuation"
            style={[font.body, styles.input, { color: isoDate ? t.text : t.warning, backgroundColor: t.surface }]}
          />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            {[
              ['Heute', formatDate(todayIso())],
              ['Gestern', yesterday],
            ].map(([label, value]) => (
              <Pressable key={label} onPress={() => setDate(value)} style={[styles.quick, { borderColor: t.border }]}>
                <Text style={[font.small, { color: date === value ? t.text : t.textMuted }]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </Field>

        <Button title="Speichern" onPress={save} disabled={!valid} />
      </ScrollView>

      <CategoryPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        categories={categories}
        selectedId={categoryId}
        allowTypes={allowTypes}
        excludeCash
        onSelect={(c) => setCategoryId(c.id)}
      />
    </KeyboardAvoidingView>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[font.caption, { color: t.textMuted, textTransform: 'uppercase' }]}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', borderRadius: radius.md, padding: 3 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.sm },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  quick: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 4 },
});
