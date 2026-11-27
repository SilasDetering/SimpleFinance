import { isHorizontalIntent, monthSwipeDirection } from '../swipe';

describe('Monatswechsel per Wischen', () => {
  it('wechselt bei klar waagerechtem Wischen', () => {
    expect(monthSwipeDirection(120, 10)).toBe(-1);
    expect(monthSwipeDirection(-120, -15)).toBe(1);
  });

  it('ignoriert schräges Wischen', () => {
    expect(monthSwipeDirection(120, 60)).toBe(0); // ~27°
    expect(monthSwipeDirection(-100, 45)).toBe(0);
    expect(monthSwipeDirection(200, 80)).toBe(0); // zu viel senkrecht
  });

  it('ignoriert kurze Wischer', () => {
    expect(monthSwipeDirection(60, 0)).toBe(0);
  });

  it('übernimmt die Geste nur bei waagerechter Absicht', () => {
    expect(isHorizontalIntent(40, 5)).toBe(true);
    expect(isHorizontalIntent(40, 20)).toBe(false);
    expect(isHorizontalIntent(20, 0)).toBe(false);
  });
});
