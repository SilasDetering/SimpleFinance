import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { formatDate } from '@/domain/dates';
import { formatCents } from '@/domain/money';
import type { Reimbursement } from '@/domain/reimburse';
import { Card, CategoryBadge, Divider, Icon, SectionTitle } from '@/ui/components';
import { useData } from '@/ui/DataProvider';
import { displayTitle } from '@/ui/TransactionRow';
import { font, space, useTheme } from '@/ui/theme';

/** Offene Erstattungen: Wer schuldet mir noch was? Darunter die zuletzt erledigten. */
export default function ReimbursementsScreen() {
  const t = useTheme();
  const { openReimbursements, reimbursementById } = useData();
  const openTotal = openReimbursements.reduce((s, r) => s + r.openCents, 0);
  const settled = useMemo(
    () =>
      [...reimbursementById.values()]
        .filter((r) => r.settled)
        .sort((a, b) => b.expense.bookingDate.localeCompare(a.expense.bookingDate))
        .slice(0, 10),
    [reimbursementById],
  );

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl, gap: space.lg }}>
      <Card>
        <Text style={[font.small, { color: t.textMuted }]}>Noch offen</Text>
        <Text style={[font.hero, { color: t.text, fontVariant: ['tabular-nums'] }]}>{formatCents(openTotal)}</Text>
        <Text style={[font.small, { color: t.textMuted }]}>
          Ausgelegtes Geld zählt nicht in Budget und Auswertung. Ordne die Rückzahlung zu, wenn sie kommt.
        </Text>
      </Card>

      <Card>
        <SectionTitle>Offen</SectionTitle>
        {openReimbursements.length === 0 ? (
          <Text style={[font.small, { color: t.textMuted, paddingBottom: space.sm }]}>
            Nichts offen. Bei einer Ausgabe, die du zurückbekommst, schalte in der Buchung „Bekomme ich zurück“ ein.
          </Text>
        ) : (
          openReimbursements.map((r, i) => (
            <View key={r.expense.id}>
              {i > 0 ? <Divider /> : null}
              <Item r={r} />
            </View>
          ))
        )}
      </Card>

      {settled.length > 0 ? (
        <Card>
          <SectionTitle>Erledigt</SectionTitle>
          {settled.map((r, i) => (
            <View key={r.expense.id}>
              {i > 0 ? <Divider /> : null}
              <Item r={r} />
            </View>
          ))}
        </Card>
      ) : null}
    </ScrollView>
  );
}

function Item({ r }: { r: Reimbursement }) {
  const t = useTheme();
  const { categoryById } = useData();
  const tx = r.expense;
  const detail = [formatDate(tx.bookingDate), tx.reimburseFrom].filter(Boolean).join(' · ');
  const right = r.settled
    ? r.openCents > 0
      ? `${formatCents(r.openCents)} selbst`
      : 'erstattet'
    : r.repaidCents > 0
      ? `${formatCents(r.openCents)} von ${formatCents(r.amountCents)}`
      : formatCents(r.openCents);
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: tx.id } })}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
    >
      <CategoryBadge category={tx.categoryId ? categoryById.get(tx.categoryId) : undefined} size={32} />
      <View style={{ flex: 1 }}>
        <Text style={[font.body, { color: t.text }]} numberOfLines={1}>
          {displayTitle(tx)}
        </Text>
        <Text style={[font.small, { color: t.textMuted }]} numberOfLines={1}>
          {detail}
        </Text>
      </View>
      <Text
        style={[
          r.settled ? font.body : font.bodyStrong,
          { color: r.settled ? t.textMuted : t.text, fontVariant: ['tabular-nums'] },
        ]}
      >
        {right}
      </Text>
      <Icon name="chevron-forward" size={16} color={t.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
});
