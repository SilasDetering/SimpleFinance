/**
 * Geometrie für das Donut-Diagramm. Winkel im Uhrzeigersinn, 0 = 12 Uhr.
 * Rein und ohne React, damit Antippen/Ziehen testbar bleibt.
 */

export interface DonutSegment {
  /** Start- und Endwinkel in Radiant, 0 = oben, im Uhrzeigersinn */
  start: number;
  end: number;
}

const TAU = Math.PI * 2;

/** Teilt den Kreis nach Werten auf. Nicht-positive Werte bekommen kein Segment (Länge 0). */
export function donutSegments(values: number[]): DonutSegment[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  let acc = 0;
  return values.map((v) => {
    const start = total ? (acc / total) * TAU : 0;
    acc += Math.max(0, v);
    return { start, end: total ? (acc / total) * TAU : 0 };
  });
}

/** Winkel eines Punkts relativ zur Mitte (dx nach rechts, dy nach unten). */
export function angleOf(dx: number, dy: number): number {
  const a = Math.atan2(dx, -dy);
  return a < 0 ? a + TAU : a;
}

/**
 * Welches Segment liegt unter dem Punkt? null, wenn der Punkt im Loch liegt
 * (näher als `minDistance` an der Mitte) oder deutlich außerhalb (weiter als `maxDistance`).
 */
export function segmentAt(
  segments: DonutSegment[],
  dx: number,
  dy: number,
  minDistance: number,
  maxDistance: number,
): number | null {
  const dist = Math.hypot(dx, dy);
  if (dist < minDistance || dist > maxDistance) return null;
  const a = angleOf(dx, dy);
  const i = segments.findIndex((s) => s.end > s.start && a >= s.start && a < s.end);
  return i === -1 ? null : i;
}

/** SVG-Pfad eines Ringsegments um (cx, cy). */
export function arcPath(cx: number, cy: number, outer: number, inner: number, start: number, end: number): string {
  // Ein voller Kreis lässt sich nicht als ein Bogen zeichnen: knapp darunter bleiben
  const sweep = Math.min(end - start, TAU - 1e-4);
  const e = start + sweep;
  const large = sweep > Math.PI ? 1 : 0;
  const p = (r: number, a: number) => `${(cx + r * Math.sin(a)).toFixed(2)} ${(cy - r * Math.cos(a)).toFixed(2)}`;
  return [
    `M ${p(outer, start)}`,
    `A ${outer} ${outer} 0 ${large} 1 ${p(outer, e)}`,
    `L ${p(inner, e)}`,
    `A ${inner} ${inner} 0 ${large} 0 ${p(inner, start)}`,
    'Z',
  ].join(' ');
}
