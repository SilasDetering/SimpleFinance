import { router } from 'expo-router';
import React, { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { cashBreakdown, type CashMovementKind } from '@/domain/cash';
import { formatDate } from '@/domain/dates';
import { formatCents } from '@/domain/money';
import { Button, Divider, Icon } from '@/ui/components';
import { useData } from '@/ui/DataProvider';
import { displayTitle } from '@/ui/TransactionRow';
import { font, radius, space, useTheme } from '@/ui/theme';

const KINDS: { kind: CashMovementKind; label: string; hint: string; sign: '+' | '−' }[] = [
  { kind: 'withdrawal', label: 'Abhebungen', hint: 'Bank-Buchungen in „Bargeld“, z. B. Geldautomat', sign: '+' },
  { kind: 'received', label: 'Bargeld erhalten', hint: 'Von dir erfasst', sign: '+' },
  { kind: 'spent', label: 'Bar-Ausgaben', hint: 'Von dir erfasst', sign: '−' },
  { kind: 'deposit', label: 'Bareinzahlungen', hint: 'Bank-Gutschriften in „Bargeld“', sign: '−' },
];

const KIND_LABEL: Record<CashMovementKind, string> = {
  withdrawal: 'Abhebung',
  received: 'Bargeld erhalten',
  spent: 'Bar-Ausgabe',
  deposit: 'Bareinzahlung',
};

/** Woher der Bargeld-Bestand kommt: Summen je Art und alle zugehörigen Buchungen mit laufendem Bestand. */
export default function CashScreen() {
  const t = useTheme();
  const { transactions } = useData();
  const b = useMemo(() => cashBreakdown(transactions), [transactions]);

  const header = (
    <View style={{ gap: space.lg, paddingTop: space.lg, paddingBottom: space.md }}>
      <View style={{ alignItems: 'center', gap: space.xs }}>
        <Text style={[font.small, { color: t.textMuted }]}>Aktueller Bestand</Text>
        <Text style={[font.title, { color: b.balanceCents < 0 ? t.warning : t.text, fontVariant: ['tabular-nums'] }]}>
          {formatCents(b.balanceCents)}
        </Text>
      </View>

      <View style={[styles.group, { backgroundColor: t.surface }]}>
        {KINDS.map(({ kind, label, hint, sign }, i) => (
          <View key={kind}>
            {i > 0 ? <Divider /> : null}
            <View style={styles.sumRow}>
              <View style={{ flex: 1 }}>
                <Text style={[font.body, { color: t.text }]}>
                  {label} <Text style={{ color: t.textMuted }}>({b.totals[kind].count})</Text>
                </Text>
                <Text style={[font.small, { color: t.textMuted }]}>{hint}</Text>
              </View>
              <Text style={[font.bodyStrong, { color: t.text, fontVariant: ['tabular-nums'] }]}>
                {sign} {formatCents(b.totals[kind].cents)}
              </Text>
            </View>
          </View>
        ))}
        <View style={[styles.totalRow, { borderTopColor: t.border }]}>
          <Text style={[font.bodyStrong, { color: t.text, flex: 1 }]}>= Bestand</Text>
          <Text style={[font.bodyStrong, { color: b.balanceCents < 0 ? t.warning : t.text, fontVariant: ['tabular-nums'] }]}>
            {formatCents(b.balanceCents)}
          </Text>
        </View>
      </View>

      {b.balanceCents < 0 ? (
        <View style={[styles.warning, { backgroundColor: t.warningBg }]}>
          <Icon name="alert-circle-outline" size={18} color={t.warning} />
          <Text style={[font.small, { color: t.warning, flex: 1 }]}>
            Der Bestand ist negativ. Wahrscheinlich ist eine Abhebung nicht der Kategorie „Bargeld“ zugeordnet oder
            erhaltenes Bargeld fehlt.
          </Text>
        </View>
      ) : null}

      <Text style={[font.small, { color: t.textMuted }]}>
        Normale Kartenzahlungen berühren die Kasse nicht. Fehlt eine Abhebung, ordne sie in der Buchung der Kategorie
        „Bargeld“ zu.
      </Text>

      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button
            title="Bar-Ausgabe"
            variant="secondary"
            icon="remove"
            onPress={() => router.push({ pathname: '/cash-entry', params: { kind: 'expense' } })}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            title="Bar erhalten"
            variant="secondary"
            icon="add"
            onPress={() => router.push({ pathname: '/cash-entry', params: { kind: 'income' } })}
          />
        </View>
      </View>

      {b.movements.length > 0 ? (
        <Text style={[font.caption, { color: t.textMuted, textTransform: 'uppercase', marginTop: space.sm }]}>
          Alle Bewegungen
        </Text>
      ) : null}
    </View>
  );

  return (
    <FlatList
      data={b.movements}
      keyExtractor={(m) => m.entry.id}
      contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: space.xxl }}
      ListHeaderComponent={header}
      ItemSeparatorComponent={Divider}
      ListEmptyComponent={
        <Text style={[font.body, { color: t.textMuted, textAlign: 'center', paddingVertical: space.xl }]}>
          Noch keine Bargeld-Bewegungen.
        </Text>
      }
      renderItem={({ item: m }) => (
        <Pressable
          onPress={() => router.push({ pathname: '/transaction/[id]', params: { id: m.entry.id } })}
          style={({ pressed }) => [styles.moveRow, { opacity: pressed ? 0.6 : 1 }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[font.body, { color: t.text }]} numberOfLines={1}>
              {displayTitle(m.entry)}
            </Text>
            <Text style={[font.small, { color: t.textMuted }]}>
              {KIND_LABEL[m.kind]} · {formatDate(m.entry.bookingDate)}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[font.bodyStrong, { color: m.effectCents > 0 ? t.income : t.text, fontVariant: ['tabular-nums'] }]}>
              {formatCents(m.effectCents, { sign: true })}
            </Text>
            <Text style={[font.small, { color: t.textFaint, fontVariant: ['tabular-nums'] }]}>
              Bestand {formatCents(m.balanceAfterCents)}
            </Text>
          </View>
        </Pressable>
      )}
    />
  );
}

const styles = StyleSheet.create({
  group: { borderRadius: radius.lg, paddingHorizontal: space.lg },
  sumRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
  },
  warning: { flexDirection: 'row', gap: space.sm, alignItems: 'center', padding: space.md, borderRadius: radius.md },
  moveRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
});
