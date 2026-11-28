import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { CATEGORY_COLORS, CATEGORY_ICONS } from '@/domain/defaults';
import { LEARNED_PRIORITY } from '@/domain/categorize';
import { budgetKindOf, budgetKindsFor, computeBudget } from '@/domain/budget';
import { todayIso } from '@/domain/dates';
import { formatCents, parseGermanAmount } from '@/domain/money';
import type { BudgetKind, CategoryType, Rule, RuleField } from '@/domain/types';
import { addRule, deleteCategory, deleteRule, recategorizeAll, saveCategory } from '@/db/repo';
import { BudgetKindSegment } from '@/ui/BudgetKindSegment';
import { Button, Icon } from '@/ui/components';
import { useData } from '@/ui/DataProvider';
import { font, radius, space, useTheme } from '@/ui/theme';

const TYPE_LABEL: Record<CategoryType, string> = { expense: 'Ausgabe', income: 'Einnahme', transfer: 'Umbuchung' };
const FIELD_LABEL: Record<RuleField, string> = {
  any: 'Überall',
  counterparty: 'Empfänger',
  purpose: 'Verwendungszweck',
  bookingText: 'Buchungstext',
};

type DraftRule = Pick<Rule, 'keyword' | 'field' | 'priority'> & { id?: string };

export default function CategoryEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const t = useTheme();
  const db = useSQLiteContext();
  const { categoryById, categories, lookup, budgetStartMonth, rules, transactions, ledger, reload } = useData();
  const existing = isNew ? undefined : categoryById.get(id);

  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<CategoryType>(existing?.type ?? 'expense');
  const [color, setColor] = useState(existing?.color ?? CATEGORY_COLORS[0]);
  const [icon, setIcon] = useState(existing?.icon ?? CATEGORY_ICONS[0]);
  // null = Standard (z. B. Lebensmittel fix, Shopping variabel)
  const [budgetKind, setBudgetKind] = useState<BudgetKind | null>(existing?.budgetKind ?? null);
  const draftCategory = { id: existing?.id ?? 'new', type, name, budgetKind };
  const budgetKinds = budgetKindsFor(draftCategory);
  const draftKind = budgetKindOf(draftCategory);
  const canPlan = draftKind === 'fixed' || draftKind === 'saving';
  // Leer = automatisch berechnen (Median der letzten Monate)
  const [plannedText, setPlannedText] = useState(
    existing?.plannedCents != null ? formatCents(existing.plannedCents, { currency: false }) : '',
  );
  // Berechneter Betrag ohne Planwert, als Vergleich unter dem Eingabefeld
  const computedCents = useMemo(() => {
    if (!existing || !canPlan) return null;
    const cats = categories.map((c) => (c.id === existing.id ? { ...c, budgetKind: draftKind, plannedCents: null } : c));
    const b = computeBudget(ledger, cats, lookup, todayIso(), { startMonth: budgetStartMonth });
    return [...b.fixed, ...b.saving].find((c) => c.categoryId === existing.id)?.totalCents ?? 0;
  }, [existing, canPlan, categories, draftKind, ledger, lookup, budgetStartMonth]);
  const initialRules = useMemo<DraftRule[]>(
    () => (existing ? rules.filter((r) => r.categoryId === existing.id).sort((a, b) => a.keyword.localeCompare(b.keyword)) : []),
    [existing, rules],
  );
  const [draftRules, setDraftRules] = useState<DraftRule[]>(initialRules);
  const [keyword, setKeyword] = useState('');
  const [field, setField] = useState<RuleField>('any');

  // Doppeltes Antippen von „Speichern" darf die Kategorie nicht zweimal anlegen
  const saving = useRef(false);

  const usage = useMemo(() => transactions.filter((tx) => tx.categoryId === existing?.id).length, [transactions, existing]);

  const addKeyword = () => {
    const k = keyword.trim();
    if (!k) return;
    if (draftRules.some((r) => r.keyword.toLowerCase() === k.toLowerCase() && r.field === field)) {
      setKeyword('');
      return;
    }
    setDraftRules((rs) => [...rs, { keyword: k, field, priority: field === 'counterparty' ? LEARNED_PRIORITY : existing?.isSystem ? 100 : 0 }]);
    setKeyword('');
  };

  const save = async () => {
    if (!name.trim()) {
      Alert.alert('Name fehlt', 'Bitte gib der Kategorie einen Namen.');
      return;
    }
    let plannedCents: number | null = null;
    if (canPlan && plannedText.trim()) {
      plannedCents = parseGermanAmount(plannedText);
      if (plannedCents === null || plannedCents < 0) {
        Alert.alert('Planwert ungültig', 'Bitte gib einen Betrag wie 80 oder 80,50 ein oder lass das Feld leer.');
        return;
      }
    }
    if (saving.current) return;
    saving.current = true;
    try {
      const categoryId = await saveCategory(db, { id: existing?.id, name: name.trim(), color, icon, type, budgetKind, plannedCents });
      const keep = new Set(draftRules.filter((r) => r.id).map((r) => r.id));
      for (const r of initialRules) if (r.id && !keep.has(r.id)) await deleteRule(db, r.id);
      for (const r of draftRules) if (!r.id) await addRule(db, { categoryId, keyword: r.keyword, field: r.field, priority: r.priority });
      await recategorizeAll(db);
      // Erst zurück, dann neu laden: sonst blitzt bei einer neuen Kategorie kurz der alte Stand auf
      router.back();
      await reload();
    } catch (e) {
      saving.current = false;
      Alert.alert('Speichern fehlgeschlagen', e instanceof Error ? e.message : String(e));
    }
  };

  const remove = () => {
    if (!existing) return;
    Alert.alert(
      'Kategorie löschen?',
      `„${existing.name}" und ihre Schlüsselwörter werden gelöscht.${usage ? ` ${usage} Buchungen werden neu zugeordnet (sonst „Sonstiges").` : ''}`,
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Löschen',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteCategory(db, existing.id);
              // Erst zurück, dann neu laden: sonst blitzt kurz „Kategorie nicht gefunden" auf
              router.back();
              await reload();
            } catch (e) {
              Alert.alert('Nicht möglich', e instanceof Error ? e.message : String(e));
            }
          },
        },
      ],
    );
  };

  if (!isNew && !existing) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: t.textMuted }}>Kategorie nicht gefunden.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: isNew ? 'Neue Kategorie' : existing!.name }} />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl, paddingBottom: space.xxl }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center' }}>
          <View style={[styles.preview, { backgroundColor: color + (t.dark ? '33' : '22') }]}>
            <Icon name={icon} size={30} color={color} />
          </View>
        </View>

        <Field label="Name">
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="z. B. Haustier"
            placeholderTextColor={t.textFaint}
            style={[font.body, styles.input, { color: t.text, backgroundColor: t.surface }]}
          />
        </Field>

        <Field label="Typ">
          <View style={[styles.segment, { backgroundColor: t.surface, opacity: existing?.isSystem ? 0.5 : 1 }]}>
            {(['expense', 'income', 'transfer'] as CategoryType[]).map((k) => (
              <Pressable
                key={k}
                disabled={existing?.isSystem}
                onPress={() => setType(k)}
                style={[styles.segmentItem, type === k && { backgroundColor: t.bg }]}
              >
                <Text style={[font.smallStrong, { color: type === k ? t.text : t.textMuted }]}>{TYPE_LABEL[k]}</Text>
              </Pressable>
            ))}
          </View>
          {type === 'transfer' ? (
            <Text style={[font.small, { color: t.textMuted }]}>Umbuchungen werden in den Auswertungen ausgeblendet.</Text>
          ) : null}
        </Field>

        {budgetKinds.length > 0 ? (
          <Field label="Im Budget">
            <BudgetKindSegment kinds={budgetKinds} value={budgetKindOf(draftCategory)} onChange={setBudgetKind} />
            <Text style={[font.small, { color: t.textMuted }]}>
              {budgetKindOf(draftCategory) === 'fixed'
                ? 'Fällt jeden Monat an und wird vom Budget abgezogen.'
                : budgetKindOf(draftCategory) === 'saving'
                  ? 'Geht als Sparrate vom Budget ab.'
                  : budgetKindOf(draftCategory) === 'variable'
                    ? 'Sonderausgabe: wird aus dem freien Budget bezahlt.'
                    : 'Spielt im Budget keine Rolle.'}
            </Text>
          </Field>
        ) : null}

        {canPlan ? (
          <Field label="Planwert pro Monat (optional)">
            <TextInput
              value={plannedText}
              onChangeText={setPlannedText}
              placeholder="Automatisch"
              placeholderTextColor={t.textFaint}
              keyboardType="decimal-pad"
              style={[font.body, styles.input, { color: t.text, backgroundColor: t.surface }]}
              accessibilityLabel="Planwert pro Monat in Euro"
            />
            <Text style={[font.small, { color: t.textMuted }]}>
              {plannedText.trim()
                ? 'Ersetzt den berechneten Betrag im Budget. Feld leeren, um wieder automatisch zu rechnen.'
                : `Leer lassen, dann rechnet die App aus deinen letzten Monaten${computedCents !== null ? ` (aktuell ${formatCents(computedCents)})` : ''}.`}
            </Text>
          </Field>
        ) : null}

        <Field label="Farbe">
          <View style={styles.wrap}>
            {CATEGORY_COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => setColor(c)}
                style={[styles.swatch, { backgroundColor: c, borderColor: color === c ? t.text : 'transparent' }]}
                accessibilityLabel={`Farbe ${c}`}
              />
            ))}
          </View>
        </Field>

        <Field label="Icon">
          <View style={styles.wrap}>
            {CATEGORY_ICONS.map((name) => (
              <Pressable
                key={name}
                onPress={() => setIcon(name)}
                style={[styles.iconCell, { backgroundColor: icon === name ? t.surfaceAlt : t.surface, borderColor: icon === name ? t.text : 'transparent' }]}
              >
                <Icon name={name} size={20} color={icon === name ? t.text : t.textMuted} />
              </Pressable>
            ))}
          </View>
        </Field>

        <Field label="Schlüsselwörter">
          <Text style={[font.small, { color: t.textMuted }]}>
            Buchungen, deren Empfänger oder Verwendungszweck eines dieser Wörter enthält, landen automatisch hier (Groß-/Kleinschreibung egal).
          </Text>
          <View style={styles.wrap}>
            {draftRules.map((r, i) => (
              <View key={`${r.id ?? 'new'}-${r.keyword}-${i}`} style={[styles.ruleChip, { backgroundColor: t.surface }]}>
                <Text style={[font.small, { color: t.text }]}>{r.keyword}</Text>
                {r.field !== 'any' ? <Text style={[font.caption, { color: t.textFaint }]}>{FIELD_LABEL[r.field]}</Text> : null}
                <Pressable onPress={() => setDraftRules((rs) => rs.filter((_, j) => j !== i))} hitSlop={8} accessibilityLabel={`${r.keyword} entfernen`}>
                  <Icon name="close" size={14} color={t.textMuted} />
                </Pressable>
              </View>
            ))}
            {draftRules.length === 0 ? <Text style={[font.small, { color: t.textFaint }]}>Noch keine Schlüsselwörter.</Text> : null}
          </View>
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <TextInput
              value={keyword}
              onChangeText={setKeyword}
              onSubmitEditing={addKeyword}
              placeholder="Schlüsselwort hinzufügen"
              placeholderTextColor={t.textFaint}
              returnKeyType="done"
              autoCapitalize="none"
              style={[font.body, styles.input, { flex: 1, color: t.text, backgroundColor: t.surface }]}
            />
            <Pressable onPress={addKeyword} style={[styles.addBtn, { backgroundColor: t.text }]} accessibilityLabel="Hinzufügen">
              <Icon name="add" size={22} color={t.bg} />
            </Pressable>
          </View>
          <View style={styles.wrap}>
            {(['any', 'counterparty', 'purpose'] as RuleField[]).map((f) => (
              <Pressable key={f} onPress={() => setField(f)} style={[styles.fieldChip, { borderColor: field === f ? t.text : t.border }]}>
                <Text style={[font.small, { color: field === f ? t.text : t.textMuted }]}>{FIELD_LABEL[f]}</Text>
              </Pressable>
            ))}
          </View>
        </Field>

        <Button title="Speichern" onPress={save} />
        {existing && !existing.isSystem ? (
          <Button title="Kategorie löschen" variant="secondary" icon="trash-outline" onPress={remove} />
        ) : null}
        {existing?.isSystem ? (
          <Text style={[font.small, { color: t.textFaint, textAlign: 'center' }]}>Diese Kategorie ist fest und kann nicht gelöscht werden.</Text>
        ) : null}
      </ScrollView>
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
  preview: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  input: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12 },
  segment: { flexDirection: 'row', borderRadius: radius.md, padding: 3 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 2 },
  iconCell: { width: 42, height: 42, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  ruleChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill },
  addBtn: { width: 46, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  fieldChip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 4 },
});
