import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, radius, space, useTheme } from './theme';

/** Schlichtes Bottom Sheet ohne Zusatz-Bibliothek (läuft in Expo Go). */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
  maxHeight = '75%',
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxHeight?: `${number}%` | number;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.root}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: t.overlay }]} onPress={onClose} accessibilityLabel="Schließen" />
        <View
          style={[
            styles.sheet,
            { backgroundColor: t.bg, paddingBottom: Math.max(insets.bottom, space.lg), maxHeight },
          ]}
        >
          <View style={[styles.handle, { backgroundColor: t.border }]} />
          {title ? <Text style={[font.h2, { color: t.text, marginBottom: space.md }]}>{title}</Text> : null}
          {children}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: radius.lg + 4,
    borderTopRightRadius: radius.lg + 4,
    paddingHorizontal: space.lg,
    paddingTop: space.sm,
  },
  handle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: space.md },
});
