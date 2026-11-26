import { useSQLiteContext } from 'expo-sqlite';
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { findConflictingRules, matchesKeyword, suggestKeyword } from '@/domain/categorize';
import type { Category, RuleField, Transaction } from '@/domain/types';
import { learnRuleFromCorrection } from '@/db/repo';
import { BottomSheet } from './BottomSheet';
import { Button, CategoryBadge } from './components';
import { useData } from './DataProvider';
import { font, radius, space, useTheme } from './theme';

/**
 * Nachfrage nach einer manuellen Umkategorisierung: "Regel anlegen?".
 * Das Stichwort ist vorbelegt (Empfänger ohne Rechtsform) und kann angepasst werden.
 * Eine Live-Vorschau zeigt, wie viele weitere Buchungen die Regel treffen würde.
 */

type AskRule = (tx: Transaction, category: Category) => void;
const RulePromptContext = createContext<AskRule | null>(null);

const FIELD_LABEL: Record<'counterparty' | 'any', string> = { counterparty: 'Im Empfänger', any: 'Überall' };

export function RulePromptProvider({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const db = useSQLiteContext();
  const { transactions, rules, categoryById, reload } = useData();
  const [state, setState] = useState<{ tx: Transaction; category: Category } | null>(null);
  const [keyword, setKeyword] = useState('');
  const [field, setField] = useState<'counterparty' | 'any'>('counterparty');
  const [saving, setSaving] = useState(false);

  const ask = useCallback<AskRule>((tx, category) => {
    setKeyword(suggestKeyword(tx.counterparty));
    setField('counterparty');
    setState({ tx, category });
  }, []);

  const close = () => setState(null);

  // Wie viele andere, automatisch kategorisierte Buchungen würde die Regel treffen?
  const affected = useMemo(() => {
    const k = keyword.trim();
    if (!state || k.length < 2) return 0;
    return transactions.filter((tx) => {
      if (tx.id === state.tx.id || tx.categoryManual || tx.source !== 'csv') return false;
      const text = field === 'counterparty' ? tx.counterparty : `${tx.counterparty} ${tx.purpose} ${tx.bookingText}`;
      return matchesKeyword(text, k);
    }).length;
  }, [transactions, keyword, field, state]);

  // Bestehende gelernte Regeln, die diese Buchung in eine andere Kategorie schicken würden
  const conflicts = useMemo(
    () => (state ? findConflictingRules(state.tx, rules, state.category.id) : []),
    [state, rules],
  );

  const create = async () => {
    if (!state || keyword.trim().length < 2) return;
    setSaving(true);
    try {
      await learnRuleFromCorrection(db, keyword.trim(), state.category.id, field as RuleField, conflicts.map((r) => r.id));
      await reload();
      close();
    } finally {
      setSaving(false);
    }
  };

  const valid = keyword.trim().length >= 2;

  return (
    <RulePromptContext.Provider value={ask}>
      {children}
      <BottomSheet visible={!!state} onClose={close} title="Regel anlegen?">
        {state ? (
          <View style={{ gap: space.lg }}>
            <View style={styles.target}>
              <CategoryBadge category={state.category} size={32} />
              <Text style={[font.body, { color: t.text, flex: 1 }]}>
                Buchungen mit diesem Stichwort landen künftig automatisch in{' '}
                <Text style={font.bodyStrong}>„{state.category.name}"</Text>.
              </Text>
            </View>

            <View style={{ gap: space.sm }}>
              <Text style={[font.caption, { color: t.textMuted, textTransform: 'uppercase' }]}>Stichwort</Text>
              <TextInput
                value={keyword}
                onChangeText={setKeyword}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={create}
                placeholder="z. B. REWE"
                placeholderTextColor={t.textFaint}
                style={[font.body, styles.input, { color: t.text, backgroundColor: t.surface }]}
              />
              <View style={{ flexDirection: 'row', gap: space.sm }}>
                {(['counterparty', 'any'] as const).map((f) => (
                  <Pressable
                    key={f}
                    onPress={() => setField(f)}
                    style={[styles.fieldChip, { borderColor: field === f ? t.text : t.border }]}
                  >
                    <Text style={[font.small, { color: field === f ? t.text : t.textMuted }]}>{FIELD_LABEL[f]}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={[font.small, { color: t.textMuted }]}>
                {!valid
                  ? 'Mindestens 2 Zeichen.'
                  : affected > 0
                    ? `${affected} weitere ${affected === 1 ? 'Buchung wird' : 'Buchungen werden'} ebenfalls angepasst.`
                    : 'Aktuell trifft das Stichwort keine weiteren Buchungen.'}
              </Text>
            </View>

            {conflicts.length > 0 ? (
              <View style={[styles.conflict, { backgroundColor: t.surface }]}>
                <Text style={[font.smallStrong, { color: t.text }]}>
                  {conflicts.length === 1 ? 'Ersetzt diese Regel:' : 'Ersetzt diese Regeln:'}
                </Text>
                {conflicts.map((r) => (
                  <Text key={r.id} style={[font.small, { color: t.textMuted }]}>
                    „{r.keyword}" → {categoryById.get(r.categoryId)?.name ?? 'unbekannte Kategorie'}
                  </Text>
                ))}
              </View>
            ) : null}

            <View style={{ gap: space.sm }}>
              <Button title={conflicts.length > 0 ? 'Regel ersetzen' : 'Regel anlegen'} onPress={create} disabled={!valid || saving} />
              <Button title="Nur diese Buchung" variant="secondary" onPress={close} />
            </View>
          </View>
        ) : null}
      </BottomSheet>
    </RulePromptContext.Provider>
  );
}

export function useAskRule(): AskRule {
  const ctx = useContext(RulePromptContext);
  if (!ctx) throw new Error('useAskRule muss innerhalb von RulePromptProvider verwendet werden');
  return ctx;
}

const styles = StyleSheet.create({
  target: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  input: { borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12 },
  conflict: { borderRadius: radius.md, padding: space.md, gap: 2 },
  fieldChip: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 4 },
});
