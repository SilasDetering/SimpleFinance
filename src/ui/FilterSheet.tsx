import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { addMonths, formatMonth } from '@/domain/dates';
import { EMPTY_FILTER, UNCATEGORIZED, type FilterKind, type PeriodPreset, type TransactionFilter } from '@/domain/filter';
import type { Category } from '@/domain/types';
import { BottomSheet } from './BottomSheet';
import { Button, Icon } from './components';
import { font, radius, space, useTheme } from './theme';

const KIND_LABEL: Record<FilterKind, string> = { all: 'Alle', income: 'Einnahmen', expense: 'Ausgaben' };
const PRESET_LABEL: Record<PeriodPreset, string> = {
  all: 'Gesamt',
  thisMonth: 'Dieser Monat',
  lastMonth: 'Letzter Monat',
  last3: 'Letzte 3 Monate',
  thisYear: 'Dieses Jahr',
  custom: 'Eigener Zeitraum',
};

export function presetLabel(f: TransactionFilter): string {
  if (f.preset === 'custom' && f.fromMonth && f.toMonth) {
    return f.fromMonth === f.toMonth ? formatMonth(f.fromMonth) : `${formatMonth(f.fromMonth)} – ${formatMonth(f.toMonth)}`;
  }
  return PRESET_LABEL[f.preset];
}

export { KIND_LABEL };

/** Filter für den Verlauf: Art (Einnahmen/Ausgaben), Kategorien und Zeitraum. */
export function FilterSheet({
  visible,
  onClose,
  value,
  onApply,
  categories,
  firstMonth,
  lastMonth,
}: {
  visible: boolean;
  onClose: () => void;
  value: TransactionFilter;
  onApply: (f: TransactionFilter) => void;
  categories: Category[];
  firstMonth: string;
  lastMonth: string;
}) {
  const t = useTheme();
  const [draft, setDraft] = useState<TransactionFilter>(value);

  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleCategory = (id: string) =>
    setDraft((d) => ({
      ...d,
      categoryIds: d.categoryIds.includes(id) ? d.categoryIds.filter((x) => x !== id) : [...d.categoryIds, id],
    }));

  const setPreset = (preset: PeriodPreset) =>
    setDraft((d) => {
      if (preset !== 'custom') return { ...d, preset };
      const defaultFrom = addMonths(lastMonth, -2) < firstMonth ? firstMonth : addMonths(lastMonth, -2);
      return { ...d, preset, fromMonth: d.fromMonth ?? defaultFrom, toMonth: d.toMonth ?? lastMonth };
    });

  const chip = (selected: boolean) => [
    styles.chip,
    { borderColor: selected ? t.text : t.border, backgroundColor: selected ? t.text : 'transparent' },
  ];
  const chipText = (selected: boolean) => [font.small, { color: selected ? t.bg : t.textMuted }];

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Filter" maxHeight="85%">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: space.xl, paddingBottom: space.md }}>
        <Section label="Art">
          <View style={[styles.segment, { backgroundColor: t.surface }]}>
            {(['all', 'income', 'expense'] as FilterKind[]).map((k) => (
              <Pressable
                key={k}
                onPress={() => setDraft((d) => ({ ...d, kind: k }))}
                style={[styles.segmentItem, draft.kind === k && { backgroundColor: t.bg }]}
              >
                <Text style={[font.smallStrong, { color: draft.kind === k ? t.text : t.textMuted }]}>{KIND_LABEL[k]}</Text>
              </Pressable>
            ))}
          </View>
          {draft.kind !== 'all' ? (
            <Text style={[font.small, { color: t.textFaint }]}>Umbuchungen und Bargeld-Abhebungen sind hier ausgeblendet.</Text>
          ) : null}
        </Section>

        <Section label="Zeitraum">
          <View style={styles.wrap}>
            {(Object.keys(PRESET_LABEL) as PeriodPreset[]).map((p) => (
              <Pressable key={p} onPress={() => setPreset(p)} style={chip(draft.preset === p)}>
                <Text style={chipText(draft.preset === p)}>{PRESET_LABEL[p]}</Text>
              </Pressable>
            ))}
          </View>
          {draft.preset === 'custom' ? (
            <View style={{ gap: space.sm }}>
              <MonthStepper
                label="Von"
                value={draft.fromMonth ?? firstMonth}
                min={firstMonth}
                max={draft.toMonth ?? lastMonth}
                onChange={(m) => setDraft((d) => ({ ...d, fromMonth: m }))}
              />
              <MonthStepper
                label="Bis"
                value={draft.toMonth ?? lastMonth}
                min={draft.fromMonth ?? firstMonth}
                max={lastMonth}
                onChange={(m) => setDraft((d) => ({ ...d, toMonth: m }))}
              />
            </View>
          ) : null}
        </Section>

        <Section label={`Kategorie${draft.categoryIds.length ? ` (${draft.categoryIds.length})` : ''}`}>
          <View style={styles.wrap}>
            {categories.map((c) => {
              const selected = draft.categoryIds.includes(c.id);
              return (
                <Pressable key={c.id} onPress={() => toggleCategory(c.id)} style={[chip(selected), styles.catChip]}>
                  <Icon name={c.icon} size={13} color={selected ? t.bg : c.color} />
                  <Text style={chipText(selected)}>{c.name}</Text>
                </Pressable>
              );
            })}
            <Pressable
              onPress={() => toggleCategory(UNCATEGORIZED)}
              style={[chip(draft.categoryIds.includes(UNCATEGORIZED)), styles.catChip]}
            >
              <Icon name="help-circle-outline" size={13} color={draft.categoryIds.includes(UNCATEGORIZED) ? t.bg : t.textMuted} />
              <Text style={chipText(draft.categoryIds.includes(UNCATEGORIZED))}>Ohne Kategorie</Text>
            </Pressable>
          </View>
        </Section>
      </ScrollView>

      <View style={styles.actions}>
        <Button title="Zurücksetzen" variant="secondary" style={{ flex: 1 }} onPress={() => setDraft(EMPTY_FILTER)} />
        <Button
          title="Anwenden"
          style={{ flex: 1 }}
          onPress={() => {
            onApply(draft);
            onClose();
          }}
        />
      </View>
    </BottomSheet>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: space.sm }}>
      <Text style={[font.caption, { color: t.textMuted, textTransform: 'uppercase' }]}>{label}</Text>
      {children}
    </View>
  );
}

function MonthStepper({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min: string;
  max: string;
  onChange: (m: string) => void;
}) {
  const t = useTheme();
  const canPrev = value > min;
  const canNext = value < max;
  return (
    <View style={[styles.stepper, { backgroundColor: t.surface }]}>
      <Text style={[font.small, { color: t.textMuted, width: 36 }]}>{label}</Text>
      <Pressable onPress={() => canPrev && onChange(addMonths(value, -1))} hitSlop={8} style={{ opacity: canPrev ? 1 : 0.25 }}>
        <Icon name="chevron-back" size={18} color={t.text} />
      </Pressable>
      <Text style={[font.bodyStrong, { color: t.text, flex: 1, textAlign: 'center' }]}>{formatMonth(value)}</Text>
      <Pressable onPress={() => canNext && onChange(addMonths(value, 1))} hitSlop={8} style={{ opacity: canNext ? 1 : 0.25 }}>
        <Icon name="chevron-forward" size={18} color={t.text} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', borderRadius: radius.md, padding: 3 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 6 },
  catChip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderRadius: radius.md, padding: space.md },
  actions: { flexDirection: 'row', gap: space.sm, paddingTop: space.md },
});
