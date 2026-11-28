import React, { useMemo, useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from './components';
import { font, useTheme } from './theme';

const ACTION_WIDTH = 88;
const DANGER = '#DC2626';

/**
 * Zeile nach links wischen legt einen roten „Löschen"-Knopf frei (wie in iOS).
 * Kommt ohne zusätzliche native Bibliothek aus (PanResponder + Animated),
 * damit kein neuer App-Build nötig ist. Nur klar waagerechte Gesten zählen,
 * senkrechtes Scrollen der Liste bleibt unberührt.
 */
export function SwipeToDelete({ children, onDelete }: { children: React.ReactNode; onDelete: (close: () => void) => void }) {
  const t = useTheme();
  const x = useRef(new Animated.Value(0)).current;
  const open = useRef(false);
  const start = useRef(0);

  const animateTo = (to: number) => {
    open.current = to !== 0;
    Animated.spring(x, { toValue: to, useNativeDriver: true, bounciness: 0, speed: 20 }).start();
  };
  const close = () => animateTo(0);

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Offene Zeile: ein Tipp auf den Inhalt klappt sie zu statt die Buchung zu öffnen
        onStartShouldSetPanResponderCapture: () => open.current,
        onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          x.stopAnimation((v) => (start.current = v));
        },
        onPanResponderMove: (_, g) => {
          const next = Math.min(0, Math.max(-ACTION_WIDTH * 1.5, start.current + g.dx));
          x.setValue(next);
        },
        onPanResponderRelease: (_, g) => {
          const moved = Math.abs(g.dx) > 4;
          if (!moved && open.current) return animateTo(0);
          const end = start.current + g.dx;
          animateTo(end < -ACTION_WIDTH / 2 || g.vx < -0.5 ? -ACTION_WIDTH : 0);
        },
        onPanResponderTerminate: () => animateTo(open.current ? -ACTION_WIDTH : 0),
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={() => onDelete(close)}
        style={[styles.action, { backgroundColor: DANGER }]}
        accessibilityRole="button"
        accessibilityLabel="Löschen"
      >
        <Icon name="trash-outline" size={20} color="#fff" />
        <Text style={[font.caption, { color: '#fff' }]}>Löschen</Text>
      </Pressable>
      <Animated.View {...responder.panHandlers} style={{ backgroundColor: t.bg, transform: [{ translateX: x }] }}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  action: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: ACTION_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
});
