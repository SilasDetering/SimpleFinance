import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BUDGET_KIND_LABEL } from '@/domain/budget';
import type { BudgetKind } from '@/domain/types';
import { font, radius, useTheme } from './theme';

/** Kleine Segment-Auswahl für die Budget-Rolle einer Kategorie. */
export function BudgetKindSegment({
  kinds,
  value,
  onChange,
  compact,
}: {
  kinds: BudgetKind[];
  value: BudgetKind;
  onChange: (kind: BudgetKind) => void;
  compact?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={[styles.segment, { backgroundColor: compact ? t.bg : t.surface }]}>
      {kinds.map((k) => (
        <Pressable
          key={k}
          onPress={() => onChange(k)}
          hitSlop={4}
          style={[
            styles.item,
            compact ? styles.itemCompact : { flex: 1 },
            value === k && { backgroundColor: compact ? t.surfaceAlt : t.bg },
          ]}
          accessibilityRole="button"
          accessibilityState={{ selected: value === k }}
        >
          <Text style={[font.smallStrong, { color: value === k ? t.text : t.textMuted }]}>{BUDGET_KIND_LABEL[k]}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  segment: { flexDirection: 'row', borderRadius: radius.md, padding: 3 },
  item: { alignItems: 'center', paddingVertical: 8, borderRadius: radius.sm },
  itemCompact: { paddingVertical: 5, paddingHorizontal: 10 },
});
