import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { formatDate, formatDayShort } from '@/domain/dates';
import { formatCents } from '@/domain/money';
import { canBeRepayment, suggestExpensesFor, suggestPaymentsFor } from '@/domain/reimburse';
import { CATEGORY_CASH, type Transaction } from '@/domain/types';
import { linkRepayment, setReimbursable, setReimburseFrom, setReimburseState } from '@/db/repo';
import { BottomSheet } from './BottomSheet';
import { Button, Divider, Icon } from './components';
import { useData } from './DataProvider';
import { displayTitle } from './TransactionRow';
import { font, radius, space, useTheme } from './theme';

/** Kurzer Name einer erstattbaren Ausgabe, z. B. „Deutsche Bahn · 12.11.". */
export function reimburseLabel(tx: Transaction): string {
  return `${displayTitle(tx)} · ${formatDayShort(tx.bookingDate)}`;
}

function openTx(id: string) {
  router.push({ pathname: '/transaction/[id]', params: { id } });
}

async function run(task: () => Promise<void>, reload: () => Promise<void>) {
  try {
    await task();
    await reload();
  } catch (e) {
    Alert.alert('Speichern fehlgeschlagen', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Abschnitt „Erstattung" in der Buchungs-Detailansicht.
 * Ausgabe: als erstattbar markieren, Geldeingänge zuordnen, Rest selbst tragen.
 * Geldeingang: einer offenen Erstattung zuordnen bzw. die Zuordnung lösen.
 */
export function ReimburseSection({ tx }: { tx: Transaction }) {
  const { lookup } = useData();
  if (tx.categoryId === CATEGORY_CASH || lookup.get(tx.categoryId ?? '')?.type === 'transfer') return null;
  if (tx.amountCents < 0 && !tx.reimbursesId) return <ExpenseSection tx={tx} />;
  if (canBeRepayment(tx)) return <PaymentSection tx={tx} />;
  return null;
}

function ExpenseSection({ tx }: { tx: Transaction }) {
  const t = useTheme();
  const db = useSQLiteContext();
  const { transactions, reimbursementById, reload } = useData();
  const r = reimbursementById.get(tx.id);
  const [from, setFrom] = useState(tx.reimburseFrom ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => setFrom(tx.reimburseFrom ?? ''), [tx.id, tx.reimburseFrom]);

  const candidates = useMemo(
    () => (r && !r.settled ? suggestPaymentsFor(tx, r.openCents, transactions).slice(0, 30) : []),
    [r, tx, transactions],
  );

  const toggle = (on: boolean) => {
    if (on || !r?.payments.length) {
      run(() => setReimbursable(db, tx.id, on), reload);
      return;
    }
    Alert.alert('Nicht mehr erstattbar?', 'Zugeordnete Rückzahlungen zählen dann wieder als normale Einnahmen.', [
      { text: 'Abbrechen', style: 'cancel' },
      { text: 'Aufheben', style: 'destructive', onPress: () => run(() => setReimbursable(db, tx.id, false), reload) },
    ]);
  };

  const saveFrom = () => {
    if ((tx.reimburseFrom ?? '') === from.trim()) return;
    run(() => setReimburseFrom(db, tx.id, from), reload);
  };

  let status = '';
  if (r) {
    if (r.openCents === 0) status = r.repaidCents > r.amountCents ? 'Mehr als ausgelegt zurückbekommen.' : 'Vollständig erstattet.';
    else if (r.settled) status = `Abgeschlossen. ${formatCents(r.openCents)} zählen als deine Ausgabe.`;
    else if (r.repaidCents > 0) status = `${formatCents(r.repaidCents)} von ${formatCents(r.amountCents)} zurück, ${formatCents(r.openCents)} offen. Zählt bis zum Abschluss nicht in Budget und Auswertung.`;
    else status = 'Offen. Zählt nicht in Budget und Auswertung, bis das Geld zurück ist.';
  }

  return (
    <View style={{ gap: space.sm }}>
      <Text style={[font.caption, { color: t.textMuted, textTransform: 'uppercase' }]}>Erstattung</Text>
      <View style={[styles.card, { backgroundColor: t.surface }]}>
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={[font.body, { color: t.text }]}>Bekomme ich zurück</Text>
            {!r ? (
              <Text style={[font.small, { color: t.textMuted }]}>z. B. Dienstreise oder für einen Freund ausgelegt</Text>
            ) : null}
          </View>
          <Switch value={!!r} onValueChange={toggle} />
        </View>

        {r ? (
          <>
            <Divider />
            <TextInput
              value={from}
              onChangeText={setFrom}
              onBlur={saveFrom}
              onSubmitEditing={saveFrom}
              placeholder="Von wem? (z. B. Arbeit, Max)"
              placeholderTextColor={t.textFaint}
              returnKeyType="done"
              style={[font.body, styles.input, { color: t.text }]}
            />
            <Divider />
            <Text style={[font.small, { color: t.textMuted, paddingVertical: space.md }]}>{status}</Text>
            {r.payments.map((p) => (
              <View key={p.id}>
                <Divider />
                <Pressable onPress={() => openTx(p.id)} style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}>
                  <Icon name="return-down-back-outline" size={16} color={t.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={[font.body, { color: t.text }]} numberOfLines={1}>
                      {displayTitle(p)}
                    </Text>
                    <Text style={[font.small, { color: t.textMuted }]}>{formatDate(p.bookingDate)}</Text>
                  </View>
                  <Text style={[font.bodyStrong, { color: t.income, fontVariant: ['tabular-nums'] }]}>
                    {formatCents(p.amountCents, { sign: true })}
                  </Text>
                </Pressable>
              </View>
            ))}
          </>
        ) : null}
      </View>

      {r && !r.settled ? (
        <View style={{ gap: space.sm }}>
          <Button title="Rückzahlung zuordnen" icon="link-outline" variant="secondary" onPress={() => setPickerOpen(true)} />
          <Button
            title={r.repaidCents > 0 ? `Abschließen, ${formatCents(r.openCents)} selbst tragen` : 'Kommt nicht mehr, selbst tragen'}
            variant="secondary"
            onPress={() => run(() => setReimburseState(db, tx.id, 'done'), reload)}
          />
        </View>
      ) : null}
      {r && r.settled && r.openCents > 0 ? (
        <Button title="Wieder öffnen" variant="secondary" onPress={() => run(() => setReimburseState(db, tx.id, 'open'), reload)} />
      ) : null}

      <BottomSheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title="Rückzahlung zuordnen">
        {candidates.length === 0 ? (
          <Text style={[font.body, { color: t.textMuted, paddingBottom: space.lg }]}>
            Noch kein passender Geldeingang. Sobald die Rückzahlung importiert ist, kannst du sie hier oder direkt in der
            Buchung zuordnen.
          </Text>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            {candidates.map((p, i) => (
              <View key={p.id}>
                {i > 0 ? <Divider /> : null}
                <Pressable
                  onPress={() => {
                    setPickerOpen(false);
                    run(() => linkRepayment(db, p.id, tx.id), reload);
                  }}
                  style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[font.body, { color: t.text }]} numberOfLines={1}>
                      {displayTitle(p)}
                    </Text>
                    <Text style={[font.small, { color: t.textMuted }]}>{formatDate(p.bookingDate)}</Text>
                  </View>
                  <Text style={[font.bodyStrong, { color: t.income, fontVariant: ['tabular-nums'] }]}>
                    {formatCents(p.amountCents, { sign: true })}
                  </Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}
      </BottomSheet>
    </View>
  );
}

function PaymentSection({ tx }: { tx: Transaction }) {
  const t = useTheme();
  const db = useSQLiteContext();
  const { transactions, reimbursementById, openReimbursements, reload } = useData();
  const [pickerOpen, setPickerOpen] = useState(false);
  const linked = tx.reimbursesId ? reimbursementById.get(tx.reimbursesId) : undefined;
  const linkedExpense = linked?.expense ?? (tx.reimbursesId ? transactions.find((x) => x.id === tx.reimbursesId) : undefined);
  const candidates = useMemo(() => suggestExpensesFor(tx, openReimbursements), [tx, openReimbursements]);

  if (!linkedExpense && candidates.length === 0) return null;

  return (
    <View style={{ gap: space.sm }}>
      <Text style={[font.caption, { color: t.textMuted, textTransform: 'uppercase' }]}>Erstattung</Text>
      {linkedExpense ? (
        <>
          <Pressable
            onPress={() => openTx(linkedExpense.id)}
            style={({ pressed }) => [styles.card, styles.row, { backgroundColor: t.surface, opacity: pressed ? 0.7 : 1 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={[font.small, { color: t.textMuted }]}>Rückzahlung für</Text>
              <Text style={[font.body, { color: t.text }]} numberOfLines={1}>
                {reimburseLabel(linkedExpense)}
              </Text>
            </View>
            <Text style={[font.body, { color: t.text, fontVariant: ['tabular-nums'] }]}>
              {formatCents(linkedExpense.amountCents, { sign: true })}
            </Text>
            <Icon name="chevron-forward" size={16} color={t.textFaint} />
          </Pressable>
          <Text style={[font.small, { color: t.textMuted }]}>Zählt nicht als Einnahme.</Text>
          <Button title="Zuordnung lösen" variant="secondary" onPress={() => run(() => linkRepayment(db, tx.id, null), reload)} />
        </>
      ) : (
        <>
          <Button title="Als Rückzahlung zuordnen" icon="link-outline" variant="secondary" onPress={() => setPickerOpen(true)} />
          <Text style={[font.small, { color: t.textMuted }]}>
            Für Geld, das du ausgelegt hast. Die Buchung zählt dann nicht als Einnahme.
          </Text>
        </>
      )}

      <BottomSheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title="Offene Erstattungen">
        <ScrollView showsVerticalScrollIndicator={false}>
          {candidates.map((r, i) => (
            <View key={r.expense.id}>
              {i > 0 ? <Divider /> : null}
              <Pressable
                onPress={() => {
                  setPickerOpen(false);
                  run(() => linkRepayment(db, tx.id, r.expense.id), reload);
                }}
                style={({ pressed }) => [styles.row, { opacity: pressed ? 0.6 : 1 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[font.body, { color: t.text }]} numberOfLines={1}>
                    {displayTitle(r.expense)}
                  </Text>
                  <Text style={[font.small, { color: t.textMuted }]} numberOfLines={1}>
                    {[formatDate(r.expense.bookingDate), r.expense.reimburseFrom].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Text style={[font.bodyStrong, { color: t.text, fontVariant: ['tabular-nums'] }]}>
                  {formatCents(r.openCents)} offen
                </Text>
              </Pressable>
            </View>
          ))}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, paddingHorizontal: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
  input: { paddingVertical: space.md },
});
