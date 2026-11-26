import React, { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { font, radius, space, useTheme } from './theme';

/*
 * Zählt offene (oder gerade noch schließende) Sheets. iOS kann kein zweites Modal zeigen,
 * solange das erste noch animiert; passiert das trotzdem, bleibt eine unsichtbare Ebene liegen
 * und die App reagiert nicht mehr (z. B. kein „Zurück“). Folge-Sheets warten deshalb hierauf.
 */
const sheets = { open: 0, listeners: new Set<() => void>() };
function changeOpen(delta: number) {
  sheets.open = Math.max(0, sheets.open + delta);
  sheets.listeners.forEach((l) => l());
}
function subscribe(listener: () => void) {
  sheets.listeners.add(listener);
  return () => sheets.listeners.delete(listener);
}
/** true, solange irgendein Bottom Sheet sichtbar ist oder noch zuklappt. */
export function useAnySheetOpen(): boolean {
  return useSyncExternalStore(subscribe, () => sheets.open > 0);
}

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
  const counted = useRef(false);
  const release = useCallback(() => {
    if (!counted.current) return;
    counted.current = false;
    changeOpen(-1);
  }, []);

  useEffect(() => {
    if (visible) {
      if (!counted.current) {
        counted.current = true;
        changeOpen(1);
      }
      return;
    }
    if (!counted.current) return;
    // iOS meldet das Ende der Animation über onDismiss; der Timer ist nur die Rückfallebene
    const timer = setTimeout(release, Platform.OS === 'ios' ? 1000 : 350);
    return () => clearTimeout(timer);
  }, [visible, release]);
  useEffect(() => release, [release]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onDismiss={release}
      statusBarTranslucent
    >
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
