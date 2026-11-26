import React, { useMemo, useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { BarChart, LineChart, PieChart } from 'react-native-gifted-charts';
import { SafeAreaView } from 'react-native-safe-area-context';
import { incomeExpense } from '@/domain/cash';
import { formatDate, formatMonth, formatMonthShort } from '@/domain/dates';
import { formatCents, formatCentsShort, formatPercent } from '@/domain/money';
import { detectRecurring, recurringTotal } from '@/domain/recurring';
import {
  balanceSeries,
  categoryVsAverage,
  expensesByCategory,
  inPeriod,
  monthlySeries,
  monthsWithData,
  savingsRate,
  topCounterparties,
  type Period,
} from '@/domain/stats';
import { ACCOUNT_GIRO, CATEGORY_OTHER } from '@/domain/types';
import { Card, CategoryBadge, Divider, Icon, SectionTitle } from '@/ui/components';
import { useData } from '@/ui/DataProvider';
import { font, radius, space, useTheme } from '@/ui/theme';

export default function InsightsScreen() {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const { transactions, categoryById, lookup, cashBalanceCents } = useData();
  const months = useMemo(() => monthsWithData(transactions), [transactions]);
  const latest = months[months.length - 1];
  // Ohne explizite Auswahl wird automatisch der neueste Monat gezeigt
  const [chosen, setPeriod] = useState<Period | null>(null);
  const period: Period =
    chosen && (chosen.kind === 'all' || months.includes(chosen.month))
      ? chosen
      : latest
        ? { kind: 'month', month: latest }
        : { kind: 'all' };
  const [barMonths, setBarMonths] = useState<6 | 12>(6);
  const [showAllRecurring, setShowAllRecurring] = useState(false);

  const monthIndex = period.kind === 'month' ? months.indexOf(period.month) : -1;
  const canPrev = period.kind === 'month' && monthIndex > 0;
  const canNext = period.kind === 'month' && monthIndex >= 0 && monthIndex < months.length - 1;
  const step = (dir: -1 | 1) => {
    if (period.kind !== 'month') return;
    const next = months[monthIndex + dir];
    if (next) setPeriod({ kind: 'month', month: next });
  };
  const stepRef = useRef(step);
  stepRef.current = step;

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 30 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderRelease: (_, g) => {
        if (g.dx > 60) stepRef.current(-1);
        else if (g.dx < -60) stepRef.current(1);
      },
    }),
  ).current;

  const inRange = useMemo(() => transactions.filter((tx) => inPeriod(tx, period)), [transactions, period]);
  const totals = useMemo(() => incomeExpense(inRange, lookup), [inRange, lookup]);
  const rate = savingsRate(totals.incomeCents, totals.expenseCents);
  const byCategory = useMemo(() => expensesByCategory(inRange, lookup), [inRange, lookup]);
  const deviations = useMemo(
    () => (period.kind === 'month' ? categoryVsAverage(transactions, lookup, period.month).slice(0, 3) : []),
    [transactions, lookup, period],
  );
  const endMonth = period.kind === 'month' ? period.month : latest;
  const bars = useMemo(
    () => (endMonth ? monthlySeries(transactions, lookup, endMonth, barMonths) : []),
    [transactions, lookup, endMonth, barMonths],
  );
  const top = useMemo(() => topCounterparties(inRange, lookup, 5), [inRange, lookup]);
  const recurring = useMemo(() => detectRecurring(transactions, lookup), [transactions, lookup]);
  const balance = useMemo(
    () => balanceSeries(transactions.filter((tx) => tx.accountId === ACCOUNT_GIRO)),
    [transactions],
  );

  if (transactions.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
        <View style={{ padding: space.lg }}>
          <Text style={[font.title, { color: t.text, marginTop: space.sm }]}>Auswertungen</Text>
          <Text style={[font.body, { color: t.textMuted, marginTop: space.xl }]}>
            Sobald du eine CSV importiert hast, findest du hier deine Übersicht.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const chartWidth = width - space.lg * 4 - 40;
  const pieData = byCategory.map((c) => ({
    value: c.cents,
    color: categoryById.get(c.categoryId)?.color ?? t.textFaint,
  }));
  const barData = bars.flatMap((b) => [
    {
      value: b.incomeCents / 100,
      frontColor: t.income,
      spacing: 3,
      label: formatMonthShort(b.month),
      labelWidth: 34,
      labelTextStyle: { color: t.textMuted, fontSize: 11 },
    },
    { value: b.expenseCents / 100, frontColor: t.dark ? '#5B6270' : '#C7CCD4' },
  ]);
  const barGroupWidth = Math.max(8, Math.floor((chartWidth - bars.length * 14) / (bars.length * 2)));
  const step2 = Math.max(1, Math.ceil(balance.length / 60));
  const lineData = balance.filter((_, i) => i % step2 === 0 || i === balance.length - 1).map((p) => ({ value: p.cents / 100 }));
  const lineMin = Math.min(...lineData.map((d) => d.value), 0);
  const recurringShown = showAllRecurring ? recurring : recurring.slice(0, 4);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl, gap: space.lg }} {...pan.panHandlers}>
        <Text style={[font.title, { color: t.text, marginTop: space.sm }]}>Auswertungen</Text>

        {/* Zeitraum-Auswahl */}
        <View style={styles.periodRow}>
          <Pressable onPress={() => step(-1)} disabled={!canPrev} hitSlop={10} style={{ opacity: canPrev ? 1 : 0.25 }} accessibilityLabel="Vorheriger Monat">
            <Icon name="chevron-back" size={22} color={t.text} />
          </Pressable>
          <Text style={[font.h2, { color: t.text, flex: 1, textAlign: 'center' }]}>
            {period.kind === 'month' ? formatMonth(period.month) : 'Gesamter Zeitraum'}
          </Text>
          <Pressable onPress={() => step(1)} disabled={!canNext} hitSlop={10} style={{ opacity: canNext ? 1 : 0.25 }} accessibilityLabel="Nächster Monat">
            <Icon name="chevron-forward" size={22} color={t.text} />
          </Pressable>
        </View>
        <View style={[styles.segment, { backgroundColor: t.surface }]}>
          {(['month', 'all'] as const).map((k) => (
            <Pressable
              key={k}
              onPress={() => setPeriod(k === 'all' ? { kind: 'all' } : { kind: 'month', month: latest })}
              style={[styles.segmentItem, period.kind === k && { backgroundColor: t.bg }]}
            >
              <Text style={[font.smallStrong, { color: period.kind === k ? t.text : t.textMuted }]}>
                {k === 'month' ? 'Monat' : 'Gesamt'}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Kennzahlen */}
        <Card>
          <View style={styles.kpis}>
            <Kpi label="Einnahmen" value={formatCents(totals.incomeCents)} color={t.income} />
            <Kpi label="Ausgaben" value={formatCents(totals.expenseCents)} />
          </View>
          <Divider />
          <View style={[styles.kpis, { paddingTop: space.md }]}>
            <Kpi label="Saldo" value={formatCents(totals.saldoCents, { sign: true })} color={totals.saldoCents >= 0 ? t.income : t.text} />
            <Kpi label="Sparquote" value={rate === null ? '–' : formatPercent(rate)} />
          </View>
        </Card>

        {/* Ausgaben nach Kategorie */}
        <Card>
          <SectionTitle>Ausgaben nach Kategorie</SectionTitle>
          {byCategory.length === 0 ? (
            <Text style={[font.small, { color: t.textMuted }]}>Keine Ausgaben in diesem Zeitraum.</Text>
          ) : (
            <>
              <View style={{ alignItems: 'center', paddingVertical: space.md }}>
                <PieChart
                  data={pieData}
                  donut
                  radius={88}
                  innerRadius={64}
                  innerCircleColor={t.surface}
                  strokeWidth={2}
                  strokeColor={t.surface}
                  centerLabelComponent={() => (
                    <View style={{ alignItems: 'center' }}>
                      <Text style={[font.caption, { color: t.textMuted }]}>Ausgaben</Text>
                      <Text style={[font.bodyStrong, { color: t.text }]}>{formatCentsShort(totals.expenseCents)}</Text>
                    </View>
                  )}
                />
              </View>
              {byCategory.map((c) => {
                const cat = categoryById.get(c.categoryId);
                return (
                  <View key={c.categoryId} style={styles.catRow}>
                    <View style={[styles.dot, { backgroundColor: cat?.color ?? t.textFaint }]} />
                    <Text style={[font.body, { color: t.text, flex: 1 }]} numberOfLines={1}>
                      {cat?.name ?? (c.categoryId === CATEGORY_OTHER ? 'Sonstiges' : 'Unbekannt')}
                    </Text>
                    <Text style={[font.small, { color: t.textMuted, width: 48, textAlign: 'right' }]}>{formatPercent(c.share)}</Text>
                    <Text style={[font.bodyStrong, { color: t.text, minWidth: 96, textAlign: 'right', fontVariant: ['tabular-nums'] }]}>
                      {formatCents(c.cents)}
                    </Text>
                  </View>
                );
              })}
            </>
          )}
        </Card>

        {/* Vergleich zum Durchschnitt */}
        {deviations.length > 0 ? (
          <Card>
            <SectionTitle>Im Vergleich zu deinem Ø</SectionTitle>
            {deviations.map((d) => {
              const cat = categoryById.get(d.categoryId);
              const up = d.deviation > 0;
              return (
                <View key={d.categoryId} style={styles.catRow}>
                  <CategoryBadge category={cat} size={28} />
                  <View style={{ flex: 1 }}>
                    <Text style={[font.body, { color: t.text }]}>{cat?.name ?? 'Sonstiges'}</Text>
                    <Text style={[font.small, { color: t.textMuted }]}>
                      {formatCents(d.currentCents)} statt Ø {formatCents(d.averageCents)}
                    </Text>
                  </View>
                  <Text style={[font.bodyStrong, { color: up ? t.warning : t.income }]}>
                    {up ? '+' : '−'}
                    {formatPercent(Math.abs(d.deviation))}
                  </Text>
                </View>
              );
            })}
          </Card>
        ) : null}

        {/* Einnahmen vs. Ausgaben */}
        <Card>
          <SectionTitle
            right={
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                {([6, 12] as const).map((n) => (
                  <Pressable key={n} onPress={() => setBarMonths(n)} hitSlop={6}>
                    <Text style={[font.smallStrong, { color: barMonths === n ? t.text : t.textFaint }]}>{n} M</Text>
                  </Pressable>
                ))}
              </View>
            }
          >
            Einnahmen vs. Ausgaben
          </SectionTitle>
          <BarChart
            data={barData}
            barWidth={barGroupWidth}
            spacing={14}
            initialSpacing={6}
            width={chartWidth}
            height={160}
            noOfSections={3}
            barBorderRadius={3}
            yAxisThickness={0}
            xAxisThickness={0}
            rulesColor={t.border}
            yAxisTextStyle={{ color: t.textFaint, fontSize: 10 }}
            formatYLabel={(l: string) => formatCentsShort(Number(l) * 100).replace(' €', '')}
            yAxisLabelWidth={40}
            disableScroll
            isAnimated={false}
          />
          <View style={styles.legend}>
            <Legend color={t.income} label="Einnahmen" />
            <Legend color={t.dark ? '#5B6270' : '#C7CCD4'} label="Ausgaben" />
          </View>
        </Card>

        {/* Top-Empfänger */}
        {top.length > 0 ? (
          <Card>
            <SectionTitle>Top 5 Empfänger</SectionTitle>
            {top.map((c, i) => (
              <View key={c.name} style={styles.catRow}>
                <Text style={[font.smallStrong, { color: t.textFaint, width: 16 }]}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[font.body, { color: t.text }]} numberOfLines={1}>
                    {c.name}
                  </Text>
                  <Text style={[font.small, { color: t.textMuted }]}>{c.count}× gebucht</Text>
                </View>
                <Text style={[font.bodyStrong, { color: t.text, fontVariant: ['tabular-nums'] }]}>{formatCents(c.cents)}</Text>
              </View>
            ))}
          </Card>
        ) : null}

        {/* Fixkosten */}
        <Card>
          <SectionTitle>Fixkosten & Abos</SectionTitle>
          {recurring.length === 0 ? (
            <Text style={[font.small, { color: t.textMuted }]}>
              Noch keine wiederkehrenden Zahlungen erkannt (dafür braucht es mindestens 3 Monate Daten).
            </Text>
          ) : (
            <>
              <Text style={[font.title, { color: t.text }]}>
                {formatCents(recurringTotal(recurring))}
                <Text style={[font.body, { color: t.textMuted }]}> / Monat</Text>
              </Text>
              <Text style={[font.small, { color: t.textMuted, marginBottom: space.sm }]}>
                {recurring.length} wiederkehrende Zahlungen
              </Text>
              {recurringShown.map((r) => (
                <View key={r.name} style={styles.catRow}>
                  <CategoryBadge category={r.categoryId ? categoryById.get(r.categoryId) : undefined} size={28} />
                  <View style={{ flex: 1 }}>
                    <Text style={[font.body, { color: t.text }]} numberOfLines={1}>
                      {r.name}
                    </Text>
                    <Text style={[font.small, { color: t.textMuted }]}>zuletzt {formatDate(r.lastDate)}</Text>
                  </View>
                  <Text style={[font.bodyStrong, { color: t.text, fontVariant: ['tabular-nums'] }]}>{formatCents(r.monthlyCents)}</Text>
                </View>
              ))}
              {recurring.length > 4 ? (
                <Pressable onPress={() => setShowAllRecurring((v) => !v)} style={{ paddingTop: space.sm }}>
                  <Text style={[font.smallStrong, { color: t.accent }]}>{showAllRecurring ? 'Weniger anzeigen' : `Alle ${recurring.length} anzeigen`}</Text>
                </Pressable>
              ) : null}
            </>
          )}
        </Card>

        {/* Kontostand-Verlauf */}
        {lineData.length > 1 ? (
          <Card>
            <SectionTitle>Kontostand-Verlauf</SectionTitle>
            <LineChart
              data={lineData}
              areaChart
              curved
              hideDataPoints
              thickness={2}
              color={t.accent}
              startFillColor={t.accent}
              endFillColor={t.accent}
              startOpacity={0.2}
              endOpacity={0.01}
              width={chartWidth}
              height={150}
              adjustToWidth
              initialSpacing={0}
              noOfSections={3}
              yAxisThickness={0}
              xAxisThickness={0}
              rulesColor={t.border}
              yAxisTextStyle={{ color: t.textFaint, fontSize: 10 }}
              formatYLabel={(l: string) => formatCentsShort(Number(l) * 100).replace(' €', '')}
              yAxisLabelWidth={40}
              mostNegativeValue={lineMin < 0 ? lineMin : undefined}
              disableScroll
              isAnimated={false}
            />
            <View style={[styles.legend, { justifyContent: 'space-between' }]}>
              <Text style={[font.small, { color: t.textFaint }]}>{formatDate(balance[0].date)}</Text>
              <Text style={[font.small, { color: t.textFaint }]}>{formatDate(balance[balance.length - 1].date)}</Text>
            </View>
          </Card>
        ) : null}

        {/* Bargeld */}
        <Card>
          <SectionTitle>Bargeld-Bestand</SectionTitle>
          <Text style={[font.title, { color: cashBalanceCents < 0 ? t.warning : t.text }]}>{formatCents(cashBalanceCents)}</Text>
          <Text style={[font.small, { color: t.textMuted, marginTop: 2 }]}>
            Abhebungen minus Bar-Ausgaben und Einzahlungen. Zählt nicht zum Kontostand.
          </Text>
          {cashBalanceCents < 0 ? (
            <View style={[styles.warning, { backgroundColor: t.warningBg }]}>
              <Icon name="alert-circle-outline" size={18} color={t.warning} />
              <Text style={[font.small, { color: t.warning, flex: 1 }]}>
                Der Bestand ist negativ. Wahrscheinlich fehlt eine Abhebung oder erhaltenes Bargeld.
              </Text>
            </View>
          ) : null}
        </Card>

        <Text style={[font.small, { color: t.textFaint, textAlign: 'center' }]}>
          Umbuchungen und Bargeld-Abhebungen sind ausgeblendet. Bar-Ausgaben zählen in ihrer Kategorie.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Kpi({ label, value, color }: { label: string; value: string; color?: string }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, paddingBottom: space.md }}>
      <Text style={[font.small, { color: t.textMuted }]}>{label}</Text>
      <Text style={[font.h2, { color: color ?? t.text, fontVariant: ['tabular-nums'] }]}>{value}</Text>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[font.small, { color: t.textMuted }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  segment: { flexDirection: 'row', borderRadius: radius.md, padding: 3 },
  segmentItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.sm },
  kpis: { flexDirection: 'row', gap: space.lg },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legend: { flexDirection: 'row', gap: space.lg, marginTop: space.sm },
  warning: { flexDirection: 'row', gap: space.sm, alignItems: 'center', padding: space.md, borderRadius: radius.md, marginTop: space.md },
});
