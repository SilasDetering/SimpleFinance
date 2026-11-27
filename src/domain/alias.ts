import { normalize } from './categorize';

/**
 * Automatische Benennung beim Import: Hat eine frühere Buchung einen eigenen Namen (Alias),
 * bekommt eine neue Buchung denselben Namen, wenn sie offensichtlich dieselbe Zahlung ist.
 * Typischer Fall: PayPal-Lastschriften, bei denen der Empfänger immer „PayPal" heißt.
 *
 * „Dieselbe Zahlung" heißt: gleicher Empfänger, gleicher Verwendungszweck (wechselnde Nummern
 * wie Rechnungs- oder PayPal-Referenzen ignoriert), Betrag mit gleichem Vorzeichen und höchstens
 * 10 % Abweichung.
 */

export interface AliasCandidate {
  counterparty: string;
  purpose: string;
  amountCents: number;
}

export interface AliasTemplate extends AliasCandidate {
  alias: string;
  bookingDate: string;
}

export const ALIAS_AMOUNT_TOLERANCE = 0.1;

/** Text ohne wechselnde Bestandteile: Ziffernfolgen, PayPal-Referenzen, Satzzeichen. */
export function stableText(s: string): string {
  return normalize(s)
    .replace(/[a-z]*\d[a-z0-9]*/g, ' ') // alles mit Ziffern (Referenzen, Daten, Nummern)
    .replace(/[^a-z]+/g, ' ')
    .replace(/\bpp\b/g, ' ') // Rest der PayPal-Referenz „PP.1234.PP"
    .replace(/\s+/g, ' ')
    .trim();
}

function amountsMatch(a: number, b: number): boolean {
  if (a === 0 || b === 0 || Math.sign(a) !== Math.sign(b)) return false;
  const ref = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(Math.abs(a) - Math.abs(b)) <= ref * ALIAS_AMOUNT_TOLERANCE;
}

/** Eigener Name für eine neue Buchung, übernommen von der jüngsten passenden früheren Buchung, sonst null. */
export function findAlias(tx: AliasCandidate, templates: AliasTemplate[]): string | null {
  const who = stableText(tx.counterparty);
  const what = stableText(tx.purpose);
  // Ohne aussagekräftigen Verwendungszweck wäre nur der Betrag übrig: zu unsicher
  if (what.length < 3) return null;
  let best: AliasTemplate | null = null;
  for (const tpl of templates) {
    if (!tpl.alias.trim()) continue;
    if (stableText(tpl.counterparty) !== who || stableText(tpl.purpose) !== what) continue;
    if (!amountsMatch(tx.amountCents, tpl.amountCents)) continue;
    if (!best || tpl.bookingDate > best.bookingDate) best = tpl;
  }
  return best ? best.alias.trim() : null;
}
