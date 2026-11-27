import { useSQLiteContext } from 'expo-sqlite';
import React, { useMemo } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { budgetKindOf, budgetKindsFor } from '@/domain/budget';
import type { BudgetKind, Category } from '@/domain/types';
import { setCategoryBudgetKind } from '@/db/repo';
import { BudgetKindSegment } from '@/ui/BudgetKindSegment';
import { Card, CategoryBadge, Divider } from '@/ui/components';
import { useData } from '@/ui/DataProvider';
import { font, space, useTheme } from '@/ui/theme';

/** Alle Kategorien auf einen Blick als fix, variabel oder Sparen einteilen. */
export default function BudgetCategoriesScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const { categories, reload } = useData();
  const relevant = useMemo(() => categories.filter((c) => budgetKindsFor(c).length > 0), [categories]);

  const change = async (c: Category, kind: BudgetKind) => {
    try {
      await setCategoryBudgetKind(db, c.id, kind);
      await reload();
    } catch (e) {
      Alert.alert('Speichern fehlgeschlagen', e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, paddingBottom: space.xxl }}>
      <Text style={[font.small, { color: t.textMuted }]}>
        Fix: fällt jeden Monat an (Miete, Lebensmittel, Abos). Variabel: Sonderausgaben, die aus dem freien Budget
        bezahlt werden. Sparen: Geld, das zur Seite geht (z. B. ETF-Sparplan).
      </Text>
      <Card style={{ paddingVertical: space.xs }}>
        {relevant.map((c, i) => (
          <View key={c.id}>
            {i > 0 ? <Divider /> : null}
            <View style={styles.row}>
              <CategoryBadge category={c} size={28} />
              <Text style={[font.body, { color: t.text, flex: 1 }]} numberOfLines={1}>
                {c.name}
              </Text>
              <BudgetKindSegment compact kinds={budgetKindsFor(c)} value={budgetKindOf(c)} onChange={(k) => change(c, k)} />
            </View>
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md },
});
