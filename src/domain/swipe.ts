/**
 * Erkennung der Wischgeste für den Monatswechsel in den Auswertungen.
 * Nur klar waagerechte Gesten zählen, damit schräges Scrollen keinen Monat wechselt.
 */

/** Mindeststrecke nach links/rechts in Punkten */
export const SWIPE_MIN_DX = 80;
/** Waagerechte Strecke muss mindestens so viel größer sein als die senkrechte (≈ 18° Abweichung) */
export const SWIPE_RATIO = 3;
/** Mehr senkrechte Bewegung als das ist nie ein Monatswechsel */
export const SWIPE_MAX_DY = 40;

/** Darf die Geste übernommen werden (während der Bewegung)? Etwas großzügiger als der Abschluss. */
export function isHorizontalIntent(dx: number, dy: number): boolean {
  return Math.abs(dx) > 30 && Math.abs(dx) > Math.abs(dy) * SWIPE_RATIO && Math.abs(dy) < SWIPE_MAX_DY;
}

/** Ergebnis beim Loslassen: -1 = vorheriger Monat (nach rechts gewischt), 1 = nächster, 0 = nichts. */
export function monthSwipeDirection(dx: number, dy: number): -1 | 0 | 1 {
  if (Math.abs(dx) < SWIPE_MIN_DX) return 0;
  if (Math.abs(dy) > SWIPE_MAX_DY || Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return 0;
  return dx > 0 ? -1 : 1;
}
