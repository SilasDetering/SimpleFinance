/**
 * Geldbeträge werden intern immer als ganzzahlige Cent gespeichert.
 * Formatierung und Parsing im deutschen Format.
 */

const NBSP = ' ';

/** 123456 -> "1.234,56 €" ; -1299 -> "-12,99 €" */
export function formatCents(cents: number, opts: { sign?: boolean; currency?: boolean } = {}): string {
  const { sign = false, currency = true } = opts;
  const negative = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const euros = Math.floor(abs / 100);
  const rest = abs % 100;
  const grouped = String(euros).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const prefix = negative ? '−' : sign && cents > 0 ? '+' : '';
  return `${prefix}${grouped},${String(rest).padStart(2, '0')}${currency ? `${NBSP}€` : ''}`;
}

/** Kompakte Variante ohne Nachkommastellen, z. B. für Diagramm-Achsen: "1.235 €" */
export function formatCentsShort(cents: number): string {
  const euros = Math.round(cents / 100);
  const grouped = String(Math.abs(euros)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${euros < 0 ? '−' : ''}${grouped}${NBSP}€`;
}

/**
 * Parst deutsche Beträge: "1.234,56", "-12,99", "+5", "12,5", "1234.56" (Fallback).
 * Gibt null zurück, wenn der Text kein Betrag ist.
 */
export function parseGermanAmount(input: string): number | null {
  if (input == null) return null;
  let s = String(input).trim().replace(/\s|€|EUR/gi, '').replace(/−/g, '-');
  if (!s) return null;
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  if (s.endsWith('-')) {
    negative = true;
    s = s.slice(0, -1);
  }
  if (s.includes(',')) {
    // Deutsches Format: Punkte sind Tausendertrenner
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // "1.234" ohne Komma -> Tausendertrenner
    s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [intPart, frac = ''] = s.split('.');
  const cents = Number(intPart) * 100 + Number((frac + '00').slice(0, 2));
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

/** Prozent im deutschen Format: 0.354 -> "35 %" */
export function formatPercent(ratio: number, digits = 0): string {
  const v = (ratio * 100).toFixed(digits).replace('.', ',');
  return `${v}${NBSP}%`;
}
