import React, { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { CATEGORY_CASH, type Category, type CategoryType } from '@/domain/types';
import { BottomSheet } from './BottomSheet';
import { CategoryBadge, Icon } from './components';
import { font, space, useTheme } from './theme';

const GROUP_LABEL: Record<CategoryType, string> = {
  expense: 'Ausgaben',
  income: 'Einnahmen',
  transfer: 'Umbuchungen',
};

/** Auswahl einer Kategorie als Bottom Sheet. */
export function CategoryPicker({
  visible,
  onClose,
  categories,
  selectedId,
  onSelect,
  allowTypes,
  excludeCash,
  title = 'Kategorie wählen',
}: {
  visible: boolean;
  onClose: () => void;
  categories: Category[];
  selectedId: string | null | undefined;
  onSelect: (category: Category) => void;
  allowTypes?: CategoryType[];
  excludeCash?: boolean;
  title?: string;
}) {
  const t = useTheme();
  const groups = useMemo(() => {
    const filtered = categories.filter(
      (c) => (!allowTypes || allowTypes.includes(c.type)) && !(excludeCash && c.id === CATEGORY_CASH),
    );
    return (['expense', 'income', 'transfer'] as CategoryType[])
      .map((type) => ({ type, items: filtered.filter((c) => c.type === type) }))
      .filter((g) => g.items.length > 0);
  }, [categories, allowTypes, excludeCash]);

  return (
    <BottomSheet visible={visible} onClose={onClose} title={title}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {groups.map((g) => (
          <View key={g.type} style={{ marginBottom: space.md }}>
            {groups.length > 1 ? (
              <Text style={[font.caption, { color: t.textMuted, textTransform: 'uppercase', marginBottom: space.xs }]}>
                {GROUP_LABEL[g.type]}
              </Text>
            ) : null}
            {g.items.map((c) => {
              const selected = c.id === selectedId;
              return (
                <Pressable
                  key={c.id}
                  onPress={() => {
                    onSelect(c);
                    onClose();
                  }}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space.md,
                    paddingVertical: 10,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <CategoryBadge category={c} size={32} />
                  <Text style={[selected ? font.bodyStrong : font.body, { color: t.text, flex: 1 }]}>{c.name}</Text>
                  {selected ? <Icon name="checkmark" size={20} color={t.accent} /> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </ScrollView>
    </BottomSheet>
  );
}
