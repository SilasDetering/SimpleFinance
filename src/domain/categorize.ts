import type { Rule, RuleField } from './types';

/**
 * Regelbasierte Kategorisierung.
 *
 * Bewusst als reine Funktion gehalten: Eingabe sind die Textfelder einer Buchung und
 * die Regeln, Ausgabe ist die Kategorie-ID (oder null). Später kann hier ein lokaler
 * Klassifizierer als zweite Stufe ergänzt werden (siehe `Classifier`).
 */

export interface CategorizableTx {
  counterparty: string;
  /** Eigener Name der Buchung; wird wie ein Teil des Empfängers geprüft */
  alias?: string | null;
  purpose: string;
  bookingText: string;
  amountCents?: number;
}

/** Erweiterungspunkt für einen späteren (z. B. ML-basierten) Klassifizierer. */
export interface Classifier {
  classify(tx: CategorizableTx): string | null;
}

/** Normalisiert Text für den Vergleich: Kleinschreibung, Umlaute vereinheitlicht, Leerraum reduziert. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type KeywordMatcher = (normalizedText: string) => boolean;

/**
 * Vorbereitete Prüfer je Schlüsselwort. Regeln werden pro Buchung tausendfach geprüft
 * (z. B. beim erneuten Anwenden aller Regeln); so wird jedes Schlüsselwort nur einmal
 * normalisiert und jede RegExp nur einmal gebaut.
 */
const matcherCache = new Map<string, KeywordMatcher>();
const MATCHER_CACHE_LIMIT = 2000;

function keywordMatcher(keyword: string): KeywordMatcher {
  let m = matcherCache.get(keyword);
  if (m) return m;
  const k = normalize(keyword);
  if (!k) m = () => false;
  else if (k.length <= 4) {
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(k)}($|[^a-z0-9])`);
    m = (t) => re.test(t);
  } else m = (t) => t.includes(k);
  if (matcherCache.size >= MATCHER_CACHE_LIMIT) matcherCache.clear();
  matcherCache.set(keyword, m);
  return m;
}

/**
 * Prüft, ob ein Schlüsselwort in einem Text vorkommt (case-insensitive).
 * Kurze Schlüsselwörter (≤ 4 Zeichen, z. B. "DB", "GAA", "dm") müssen als eigenes Wort
 * vorkommen, damit "DB" nicht in "Feedback" trifft. Längere werden als Teilstring gesucht.
 */
export function matchesKeyword(text: string, keyword: string): boolean {
  return keywordMatcher(keyword)(normalize(text));
}

export function fieldText(tx: CategorizableTx, field: RuleField): string {
  switch (field) {
    case 'counterparty':
      return tx.alias ? `${tx.alias} ${tx.counterparty}` : tx.counterparty;
    case 'purpose':
      return tx.purpose;
    case 'bookingText':
      return tx.bookingText;
    case 'any':
      return `${tx.alias ?? ''} ${tx.counterparty} ${tx.purpose} ${tx.bookingText}`;
  }
}

/**
 * Sortiert Regeln: höhere Priorität zuerst, bei Gleichstand das längere (spezifischere) Schlüsselwort,
 * danach die neuere Regel. So ist die Reihenfolge immer eindeutig.
 */
export function sortRules(rules: Rule[]): Rule[] {
  return [...rules].sort(
    (a, b) =>
      b.priority - a.priority ||
      normalize(b.keyword).length - normalize(a.keyword).length ||
      (b.createdAt ?? '').localeCompare(a.createdAt ?? '') ||
      a.id.localeCompare(b.id),
  );
}

/** Priorität gelernter Regeln (aus manuellen Korrekturen). */
export const LEARNED_PRIORITY = 10;

/**
 * Gelernte Regeln, die diese Buchung treffen, aber in eine andere Kategorie zeigen.
 * Beim Anlegen einer neuen gelernten Regel werden sie ersetzt, damit sich Regeln nicht widersprechen.
 */
export function findConflictingRules(tx: CategorizableTx, rules: Rule[], targetCategoryId: string): Rule[] {
  return rules.filter(
    (r) =>
      r.priority === LEARNED_PRIORITY &&
      r.categoryId !== targetCategoryId &&
      matchesKeyword(fieldText(tx, r.field), r.keyword),
  );
}

/** Findet die passende Regel. `rules` sollten idealerweise mit `sortRules` vorsortiert sein. */
export function findMatchingRule(tx: CategorizableTx, rules: Rule[], presorted = false): Rule | null {
  const ordered = presorted ? rules : sortRules(rules);
  // Jedes Feld nur einmal normalisieren, nicht einmal pro Regel
  const texts = new Map<RuleField, string>();
  for (const rule of ordered) {
    let text = texts.get(rule.field);
    if (text === undefined) {
      text = normalize(fieldText(tx, rule.field));
      texts.set(rule.field, text);
    }
    if (keywordMatcher(rule.keyword)(text)) return rule;
  }
  return null;
}

/**
 * Kategorisiert eine Buchung. Gibt null zurück, wenn keine Regel greift
 * (die UI zeigt solche Buchungen dann als "Sonstiges" / nicht kategorisiert).
 */
export function categorize(
  tx: CategorizableTx,
  rules: Rule[],
  options: { presorted?: boolean; fallback?: Classifier } = {},
): string | null {
  const rule = findMatchingRule(tx, rules, options.presorted);
  if (rule) return rule.categoryId;
  return options.fallback?.classify(tx) ?? null;
}

/** Schlägt ein Schlüsselwort für eine gelernte Regel vor (Empfängername ohne Rechtsform-Ballast). */
export function suggestKeyword(counterparty: string): string {
  const cleaned = counterparty
    .replace(/\b(gmbh|ag|se|kg|e\.?v\.?|ohg|co\.?|& co\.?|ug|mbh|inc\.?|ltd\.?)\b/gi, ' ')
    .replace(/[\s,.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || counterparty.trim();
}

/** Empfänger-Stichwort, für das nach manueller Umkategorisierung nicht nach einer Regel gefragt wird. */
export interface PromptExclusion {
  id: string;
  keyword: string;
}

/** Soll für diese Buchung die Frage "Regel anlegen?" entfallen? Prüft den Empfänger (case-insensitive). */
export function isPromptExcluded(counterparty: string, exclusions: Pick<PromptExclusion, 'keyword'>[]): boolean {
  return exclusions.some((e) => matchesKeyword(counterparty, e.keyword));
}
