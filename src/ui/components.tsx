import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { formatCents } from '@/domain/money';
import type { Category } from '@/domain/types';
import { font, radius, space, useTheme } from './theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

export function Icon({ name, size = 18, color }: { name: string; size?: number; color: string }) {
  return <Ionicons name={name as IconName} size={size} color={color} />;
}

/** Runder Farbpunkt mit Kategorie-Icon. */
export function CategoryBadge({ category, size = 36 }: { category: Category | undefined; size?: number }) {
  const t = useTheme();
  const color = category?.color ?? t.textFaint;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color + (t.dark ? '33' : '22'),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={category?.icon ?? 'help-outline'} size={size * 0.5} color={color} />
    </View>
  );
}

/**
 * Kategorie als kleiner Chip (Farbe, Icon, Name). Antippbar, um die Kategorie direkt
 * in der Liste zu ändern. Ohne Kategorie wird ein auffälliger "Kategorie wählen"-Chip gezeigt.
 */
export function CategoryChip({
  category,
  onPress,
  uncategorized,
}: {
  category: Category | undefined;
  onPress?: () => void;
  uncategorized?: boolean;
}) {
  const t = useTheme();
  const missing = uncategorized || !category;
  const color = missing ? t.accent : category!.color;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: missing ? 'transparent' : color + (t.dark ? '2E' : '1A'),
          borderColor: missing ? t.accent : 'transparent',
          opacity: pressed ? 0.6 : 1,
        },
      ]}
      accessibilityRole="button"
      accessibilityLabel={missing ? 'Kategorie wählen' : `Kategorie ${category!.name}, ändern`}
    >
      <Icon name={missing ? 'add' : category!.icon} size={12} color={color} />
      <Text style={[font.caption, { color: missing ? t.accent : t.textMuted }]} numberOfLines={1}>
        {missing ? 'Kategorie wählen' : category!.name}
      </Text>
    </Pressable>
  );
}

export function Amount({
  cents,
  style,
  signed = true,
}: {
  cents: number;
  style?: StyleProp<TextStyle>;
  signed?: boolean;
}) {
  const t = useTheme();
  return (
    <Text style={[font.bodyStrong, { color: cents > 0 ? t.income : t.expense, fontVariant: ['tabular-nums'] }, style]}>
      {formatCents(cents, { sign: signed })}
    </Text>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[{ backgroundColor: t.surface, borderRadius: radius.lg, padding: space.lg }, style]}>{children}</View>;
}

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.sectionTitle}>
      <Text style={[font.caption, { color: t.textMuted, textTransform: 'uppercase' }]}>{children}</Text>
      {right}
    </View>
  );
}

export function Button({
  title,
  onPress,
  icon,
  variant = 'primary',
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  icon?: string;
  variant?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const bg = variant === 'primary' ? t.text : variant === 'danger' ? '#DC2626' : t.surfaceAlt;
  const fg = variant === 'secondary' ? t.text : t.bg;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 },
        style,
      ]}
      accessibilityRole="button"
    >
      {icon ? <Icon name={icon} size={18} color={variant === 'danger' ? '#fff' : fg} /> : null}
      <Text style={[font.bodyStrong, { color: variant === 'danger' ? '#fff' : fg }]}>{title}</Text>
    </Pressable>
  );
}

export function ListRow({
  title,
  subtitle,
  left,
  right,
  onPress,
  chevron = true,
}: {
  title: string;
  subtitle?: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
  onPress?: () => void;
  chevron?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.listRow, { opacity: pressed ? 0.6 : 1 }]}>
      {left}
      <View style={{ flex: 1 }}>
        <Text style={[font.body, { color: t.text }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[font.small, { color: t.textMuted }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
      {onPress && chevron ? <Icon name="chevron-forward" size={16} color={t.textFaint} /> : null}
    </Pressable>
  );
}

export function Divider() {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border }} />;
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    maxWidth: 200,
  },
  sectionTitle: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.sm,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: 14,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
  },
});
