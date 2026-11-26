import * as Haptics from 'expo-haptics';
import React, { useMemo, useRef } from 'react';
import { PanResponder, Platform, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { arcPath, donutSegments, segmentAt } from '@/domain/donut';

/**
 * Donut-Diagramm mit Auswahl: Antippen wählt ein Segment, Ziehen mit dem Finger
 * entlang des Rings wechselt die Auswahl bei jedem neuen Segment (mit kurzem Haptik-Tick).
 * Ein Tipp ins Loch in der Mitte ruft `onPressCenter` auf.
 */
export function DonutChart({
  values,
  colors,
  selectedIndex,
  onSelect,
  onPressCenter,
  radius = 88,
  innerRadius = 64,
  gapColor,
  children,
}: {
  values: number[];
  colors: string[];
  selectedIndex: number | null;
  onSelect: (index: number | null) => void;
  onPressCenter?: () => void;
  radius?: number;
  innerRadius?: number;
  /** Farbe der Trennlinien zwischen Segmenten (= Hintergrund) */
  gapColor: string;
  /** Inhalt in der Mitte */
  children?: React.ReactNode;
}) {
  const grow = 8; // ausgewähltes Segment ragt so weit heraus
  const size = (radius + grow) * 2;
  const c = size / 2;
  const segments = useMemo(() => donutSegments(values), [values]);

  // Aktuelle Werte für den PanResponder, der nur einmal angelegt wird
  const state = useRef({ segments, selectedIndex, onSelect, onPressCenter, origin: { x: 0, y: 0 }, moved: false, startIndex: null as number | null });
  state.current.segments = segments;
  state.current.selectedIndex = selectedIndex;
  state.current.onSelect = onSelect;
  state.current.onPressCenter = onPressCenter;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Beim Ziehen am Ring soll die ScrollView nicht übernehmen
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        const { locationX, locationY, pageX, pageY } = e.nativeEvent;
        const s = state.current;
        s.origin = { x: pageX - locationX, y: pageY - locationY };
        s.moved = false;
        s.startIndex = s.selectedIndex;
        const i = hit(locationX - c, locationY - c);
        if (i !== null && i !== s.selectedIndex) select(i);
      },
      onPanResponderMove: (e, g) => {
        const s = state.current;
        if (Math.abs(g.dx) + Math.abs(g.dy) > 6) s.moved = true;
        const i = hit(e.nativeEvent.pageX - s.origin.x - c, e.nativeEvent.pageY - s.origin.y - c);
        if (i !== null && i !== s.selectedIndex) select(i);
      },
      onPanResponderRelease: (e) => {
        const s = state.current;
        if (s.moved) return;
        const dx = e.nativeEvent.pageX - s.origin.x - c;
        const dy = e.nativeEvent.pageY - s.origin.y - c;
        if (Math.hypot(dx, dy) < innerRadius) {
          s.onPressCenter?.();
          return;
        }
        // Erneutes Antippen des schon gewählten Segments hebt die Auswahl auf
        const i = hit(dx, dy);
        if (i !== null && i === s.startIndex) s.onSelect(null);
      },
    }),
  ).current;

  function hit(dx: number, dy: number): number | null {
    return segmentAt(state.current.segments, dx, dy, innerRadius * 0.6, radius + grow + 40);
  }

  function select(i: number) {
    state.current.selectedIndex = i;
    state.current.onSelect(i);
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
  }

  return (
    <View style={{ width: size, height: size }} {...pan.panHandlers}>
      <Svg width={size} height={size} pointerEvents="none">
        {segments.map((s, i) => {
          if (s.end <= s.start) return null;
          const selected = selectedIndex === i;
          const dimmed = selectedIndex !== null && !selected;
          return (
            <Path
              key={i}
              d={arcPath(c, c, selected ? radius + grow : radius, innerRadius, s.start, s.end)}
              fill={colors[i]}
              opacity={dimmed ? 0.35 : 1}
              stroke={gapColor}
              strokeWidth={segments.length > 1 ? 2 : 0}
            />
          );
        })}
      </Svg>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      >
        <View style={{ maxWidth: innerRadius * 1.6, alignItems: 'center' }}>{children}</View>
      </View>
    </View>
  );
}
