import { angleOf, arcPath, donutSegments, segmentAt } from '../donut';

describe('Donut-Geometrie', () => {
  const segs = donutSegments([50, 25, 25]);

  it('teilt den Kreis im Uhrzeigersinn ab 12 Uhr auf', () => {
    expect(segs[0]).toEqual({ start: 0, end: Math.PI });
    expect(segs[1].start).toBeCloseTo(Math.PI);
    expect(segs[2].end).toBeCloseTo(Math.PI * 2);
  });

  it('berechnet Winkel: oben 0, rechts 90°, unten 180°, links 270°', () => {
    expect(angleOf(0, -10)).toBeCloseTo(0);
    expect(angleOf(10, 0)).toBeCloseTo(Math.PI / 2);
    expect(angleOf(0, 10)).toBeCloseTo(Math.PI);
    expect(angleOf(-10, 0)).toBeCloseTo((3 * Math.PI) / 2);
  });

  it('findet das Segment unter dem Finger', () => {
    expect(segmentAt(segs, 70, 10, 40, 120)).toBe(0); // rechts -> erste Hälfte
    expect(segmentAt(segs, -10, 70, 40, 120)).toBe(1); // unten links
    expect(segmentAt(segs, -70, -10, 40, 120)).toBe(2); // links oben
  });

  it('ignoriert das Loch in der Mitte und Punkte weit außerhalb', () => {
    expect(segmentAt(segs, 5, 5, 40, 120)).toBeNull();
    expect(segmentAt(segs, 200, 0, 40, 120)).toBeNull();
  });

  it('überspringt Segmente ohne Wert', () => {
    const s = donutSegments([0, 10]);
    expect(segmentAt(s, 0, -60, 40, 120)).toBe(1);
  });

  it('zeichnet auch ein einzelnes Segment als (fast) vollen Ring', () => {
    expect(arcPath(100, 100, 88, 64, 0, Math.PI * 2)).toMatch(/^M 100.00 12.00 A 88 88 0 1 1 /);
  });
});
