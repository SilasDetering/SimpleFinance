import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { computeBudget, type PlannedCategory } from '@/domain/budget';
import { formatMonth, formatMonthShort, todayIso } from '@/domain/dates';
import { formatCents, formatPercent } from '@/domain/money';
import { CATEGORY_OTHER } from '@/domain/types';
import { setCategoryBudgetKind } from '@/db/repo';
import { Card, CategoryBadge, Divider, Icon, SectionTitle } from '@/ui/components';
import { useData } from '@/ui/DataProvider';
import { font, radius, space, useTheme } from '@/ui/theme';

/** Monatsbudget: regelmäßige Einnahmen − Fixkosten − Sparen = frei für Sonderausgaben. */
export default function BudgetScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const { transactions, ledger, openReimbursements, categories, categoryById, lookup, reload } = useData();
  const today = todayIso();
  const b = useMemo(() => computeBudget(ledger, categories, lookup, today), [ledger, categories, lookup, today]);
  const [showIncome, setShowIncome] = useState(false);

  if (transactions.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
        <View style={{ padding: space.lg }}>
          <Text style={[font.body, { color: t.textMuted, marginTop: space.sm }]}>
            Sobald du eine CSV importiert hast, berechnet die App hier dein Monatsbudget.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const catName = (id: string) => categoryById.get(id)?.name ?? (id === CATEGORY_OTHER ? 'Sonstiges' : 'Unbekannt');
  const left = b.freeCents - b.variableSpentCents;
  const progress = b.freeCents > 0 ? Math.min(1, b.variableSpentCents / b.freeCents) : 1;
  const over = left < 0;
  const range =
    b.months.length > 1
      ? `${formatMonthShort(b.months[0])} – ${formatMonth(b.months[b.months.length - 1])}`
      : b.months[0]
        ? formatMonth(b.months[0])
        : '';

  const markFixed = async (categoryId: string) => {
    try {
      await setCategoryBudgetKind(db, categoryId, 'fixed');
      await reload();
    } catch (e) {
      Alert.alert('Speichern fehlgeschlagen', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl, gap: space.lg }}>
        {/* Frei verfügbar + Fortschritt im laufenden Monat */}
        <Card>
          <Text style={[font.small, { color: t.textMuted }]}>Frei verfügbar pro Monat</Text>
          <Text style={[font.hero, { color: b.freeCents < 0 ? t.warning : t.text, fontVariant: ['tabular-nums'] }]}>
            {formatCents(b.freeCents)}
          </Text>
          <Text style={[font.small, { color: t.textMuted }]}>für Sonderausgaben wie Shopping, Restaurant oder Freizeit</Text>

          {b.freeCents > 0 ? (
            <View style={{ marginTop: space.lg, gap: space.sm }}>
              <View style={styles.between}>
                <Text style={[font.smallStrong, { color: t.text }]}>{formatMonth(b.currentMonth)}</Text>
                <Text style={[font.small, { color: t.textMuted }]}>
                  {formatCents(b.variableSpentCents)} ausgegeben
                </Text>
              </View>
              <View style={[styles.track, { backgroundColor: t.surfaceAlt }]}>
                <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: over ? t.warning : t.text }]} />
              </View>
              <Text style={[font.small, { color: over ? t.warning : t.textMuted }]}>
                {over
                  ? `${formatCents(-left)} über dem Budget`
                  : b.daysLeft
                    ? `Noch ${formatCents(left)} frei · etwa ${formatCents(Math.floor(left / b.daysLeft))} pro Tag`
                    : `${formatCents(left)} übrig geblieben`}
              </Text>
            </View>
          ) : null}
        </Card>

        {/* Zusammensetzung */}
        <Card>
          <SectionTitle>So setzt es sich zusammen</SectionTitle>
          <Pressable
            onPress={() => setShowIncome((v) => !v)}
            disabled={b.incomeSources.length === 0}
            style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
            accessibilityRole="button"
          >
            <Text style={[font.bodyStrong, { color: t.text, flex: 1 }]}>Regelmäßige Einnahmen</Text>
            <Text style={[font.bodyStrong, styles.amount, { color: t.income }]}>{formatCents(b.incomeCents, { sign: true })}</Text>
            {b.incomeSources.length > 0 ? (
              <Icon name={showIncome ? 'chevron-up' : 'chevron-down'} size={14} color={t.textFaint} />
            ) : null}
          </Pressable>
          {b.incomeSources.length === 0 ? (
            <Text style={[font.small, { color: t.textMuted, paddingBottom: space.sm }]}>
              Noch kein regelmäßiges Einkommen erkannt. Dafür muss ein Absender in mindestens zwei Drittel der Monate
              überweisen und in einer Einnahme-Kategorie landen.
            </Text>
          ) : showIncome ? (
            b.incomeSources.map((s) => (
              <View key={s.name} style={[styles.row, styles.sub]}>
                <Text style={[font.body, { color: t.text, flex: 1 }]} numberOfLines={1}>
                  {s.name}
                </Text>
                <Text style={[font.small, { color: t.textMuted }]}>{s.months}×</Text>
                <Text style={[font.body, styles.amount, { color: t.text }]}>{formatCents(s.monthlyCents)}</Text>
              </View>
            ))
          ) : null}

          <Divider />
          <Group title="Fixkosten" total={b.fixedCents} items={b.fixed} catName={catName} />
          <Divider />
          <Group title="Sparen" total={b.savingCents} items={b.saving} catName={catName} />
          <Divider />

          <View style={[styles.row, { paddingTop: space.md }]}>
            <Text style={[font.bodyStrong, { color: t.text, flex: 1 }]}>Frei verfügbar</Text>
            <Text style={[font.bodyStrong, styles.amount, { color: t.text }]}>{formatCents(b.freeCents)}</Text>
          </View>
          <View style={styles.between}>
            <Text style={[font.small, { color: t.textMuted }]}>
              Sparquote {b.savingsRate === null ? '–' : formatPercent(b.savingsRate)}
            </Text>
            <Text style={[font.small, { color: t.textMuted }]}>Ø Sonderausgaben {formatCents(b.variableTypicalCents)}</Text>
          </View>
        </Card>

        {/* Vorschläge: wiederkehrend, aber als variabel eingeteilt */}
        {b.suggestions.length > 0 ? (
          <Card>
            <SectionTitle>Sieht nach Fixkosten aus</SectionTitle>
            {b.suggestions.slice(0, 3).map((s) => (
              <View key={s.name} style={styles.row}>
                <CategoryBadge category={s.categoryId ? categoryById.get(s.categoryId) : undefined} size={28} />
                <View style={{ flex: 1 }}>
                  <Text style={[font.body, { color: t.text }]} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Text style={[font.small, { color: t.textMuted }]} numberOfLines={1}>
                    {formatCents(s.monthlyCents)} monatlich · {catName(s.categoryId!)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => markFixed(s.categoryId!)}
                  style={({ pressed }) => [styles.pill, { borderColor: t.border, opacity: pressed ? 0.6 : 1 }]}
                  accessibilityRole="button"
                  accessibilityLabel={`${catName(s.categoryId!)} als fix einteilen`}
                >
                  <Text style={[font.smallStrong, { color: t.text }]}>Kategorie fix</Text>
                </Pressable>
              </View>
            ))}
            <Text style={[font.small, { color: t.textFaint, marginTop: space.xs }]}>
              Gehört nur die Zahlung zu den Fixkosten, gib ihr besser eine eigene fixe Kategorie (z. B. Abos & Verträge).
            </Text>
          </Card>
        ) : null}

        {openReimbursements.length > 0 ? (
          <Pressable
            onPress={() => router.push('/reimbursements')}
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            accessibilityRole="button"
          >
            <Card style={styles.link}>
              <Icon name="return-down-back-outline" size={18} color={t.text} />
              <View style={{ flex: 1 }}>
                <Text style={[font.body, { color: t.text }]}>Offene Erstattungen</Text>
                <Text style={[font.small, { color: t.textMuted }]}>Nicht im Budget eingerechnet</Text>
              </View>
              <Text style={[font.bodyStrong, { color: t.text, fontVariant: ['tabular-nums'] }]}>
                {formatCents(openReimbursements.reduce((s, r) => s + r.openCents, 0))}
              </Text>
              <Icon name="chevron-forward" size={16} color={t.textFaint} />
            </Card>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => router.push('/budget-categories')}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          accessibilityRole="button"
        >
          <Card style={styles.link}>
            <Icon name="options-outline" size={18} color={t.text} />
            <Text style={[font.body, { color: t.text, flex: 1 }]}>Kategorien einteilen</Text>
            <Icon name="chevron-forward" size={16} color={t.textFaint} />
          </Card>
        </Pressable>

        <Text style={[font.small, { color: t.textFaint, textAlign: 'center' }]}>
          Grundlage: {range} (typischer Monat, Median). Größere Einmalbeträge bei Fixkosten und Sparen werden auf 12
          Monate umgelegt.
          {b.irregularIncomeCents > 0 ? ` Sonderzahlungen (${formatCents(b.irregularIncomeCents)}) sind nicht eingeplant.` : ''}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Group({
  title,
  total,
  items,
  catName,
}: {
  title: string;
  total: number;
  items: PlannedCategory[];
  catName: (id: string) => string;
}) {
  const t = useTheme();
  const { categoryById } = useData();
  return (
    <View style={{ paddingVertical: space.xs }}>
      <View style={styles.row}>
        <Text style={[font.bodyStrong, { color: t.text, flex: 1 }]}>{title}</Text>
        <Text style={[font.bodyStrong, styles.amount, { color: t.text }]}>{formatCents(-total, { sign: true })}</Text>
      </View>
      {items.length === 0 ? (
        <Text style={[font.small, { color: t.textMuted, paddingBottom: space.sm }]}>Keine Kategorie eingeteilt.</Text>
      ) : (
        items.map((c) => (
          <Pressable
            key={c.categoryId}
            onPress={() => router.push({ pathname: '/category/[id]', params: { id: c.categoryId } })}
            style={({ pressed }) => [styles.row, styles.sub, { opacity: pressed ? 0.6 : 1 }]}
            accessibilityRole="button"
          >
            <CategoryBadge category={categoryById.get(c.categoryId)} size={24} />
            <View style={{ flex: 1 }}>
              <Text style={[font.body, { color: t.text }]} numberOfLines={1}>
                {catName(c.categoryId)}
              </Text>
              {c.spreadCents > 0 ? (
                <Text style={[font.small, { color: t.textMuted }]}>davon {formatCents(c.spreadCents)} umgelegt</Text>
              ) : null}
            </View>
            <Text style={[font.body, styles.amount, { color: t.text }]}>{formatCents(c.totalCents)}</Text>
          </Pressable>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 8 },
  sub: { paddingLeft: space.sm, paddingVertical: 6 },
  amount: { minWidth: 88, textAlign: 'right', fontVariant: ['tabular-nums'] },
  between: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 8, borderRadius: radius.pill },
  pill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 5 },
  link: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
});
