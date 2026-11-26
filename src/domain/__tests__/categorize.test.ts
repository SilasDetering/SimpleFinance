import { categorize, findMatchingRule, matchesKeyword, suggestKeyword } from '../categorize';
import { DEFAULT_CATEGORIES } from '../defaults';
import type { Rule } from '../types';

let n = 0;
const defaultRules: Rule[] = DEFAULT_CATEGORIES.flatMap((c) =>
  c.keywords.map((keyword) => ({
    id: String(n++),
    categoryId: c.id,
    keyword,
    field: c.field ?? 'any',
    priority: c.priority ?? 0,
  })),
);

const tx = (counterparty: string, purpose = '', bookingText = 'Lastschrift') => ({ counterparty, purpose, bookingText });

describe('matchesKeyword', () => {
  it('ist case-insensitive', () => {
    expect(matchesKeyword('REWE Markt GmbH', 'rewe')).toBe(true);
    expect(matchesKeyword('rewe markt', 'REWE')).toBe(true);
  });

  it('kurze Schlüsselwörter nur als ganzes Wort', () => {
    expect(matchesKeyword('DB Vertrieb GmbH', 'DB')).toBe(true);
    expect(matchesKeyword('Feedback GmbH', 'DB')).toBe(false);
    expect(matchesKeyword('GAA Köln Hbf', 'GAA')).toBe(true);
  });

  it('vereinheitlicht Umlaute', () => {
    expect(matchesKeyword('Baeckerei Schmitz', 'Bäckerei')).toBe(true);
    expect(matchesKeyword('Bäckerei Schmitz', 'baeckerei')).toBe(true);
  });
});

describe('categorize mit Default-Regeln', () => {
  it.each([
    [tx('REWE Markt GmbH', 'REWE SAGT DANKE'), 'groceries'],
    [tx('VISA LIDL DIENSTLEISTUNG'), 'groceries'],
    [tx('ALDI SUED'), 'groceries'],
    [tx('Netflix International B.V.'), 'subscriptions'],
    [tx('Spotify AB'), 'subscriptions'],
    [tx('DB Vertrieb GmbH', 'Fahrkarte'), 'mobility'],
    [tx('ARAL Station 123'), 'mobility'],
    [tx('Amazon EU S.a.r.L.', 'AMZN Mktp DE'), 'shopping'],
    [tx('Amazon Digital', 'Amazon Prime Mitgliedschaft'), 'subscriptions'],
    [tx('Lieferando.de'), 'restaurant'],
    [tx('Muster Tech GmbH', 'Gehalt 11/2026', 'Gehalt/Rente'), 'income'],
    [tx('Max Mustermann', 'Umbuchung Extra-Konto', 'Überweisung'), 'transfer'],
    [tx('VISA SPARKASSE', 'GAA Köln Hbf', 'Bargeldauszahlung'), 'cash'],
    [tx('Sparkasse', 'Einzahlung', 'Bareinzahlung'), 'cash'],
    [tx('Zalando SE', 'Retoure Erstattung', 'Gutschrift'), 'shopping'],
  ])('%o -> %s', (t, expected) => {
    expect(categorize(t, defaultRules)).toBe(expected);
  });

  it('gibt null zurück, wenn nichts passt', () => {
    expect(categorize(tx('Unbekannter Händler XY', 'Kartenzahlung'), defaultRules)).toBeNull();
  });

  it('Bargeld hat Vorrang vor anderen Treffern', () => {
    // Abhebung an einem REWE-Automaten bleibt Bargeld
    expect(categorize(tx('REWE Markt', 'Bargeldauszahlung', 'Bargeldauszahlung'), defaultRules)).toBe('cash');
  });
});

describe('Priorität und gelernte Regeln', () => {
  it('höhere Priorität gewinnt, bei Gleichstand das längere Schlüsselwort', () => {
    const rules: Rule[] = [
      { id: '1', categoryId: 'a', keyword: 'Amazon', field: 'any', priority: 0 },
      { id: '2', categoryId: 'b', keyword: 'Amazon Prime', field: 'any', priority: 0 },
      { id: '3', categoryId: 'c', keyword: 'Amazon', field: 'counterparty', priority: 10 },
    ];
    expect(findMatchingRule(tx('Amazon', 'Amazon Prime'), rules)?.categoryId).toBe('c');
    expect(findMatchingRule(tx('Händler', 'Amazon Prime'), rules)?.categoryId).toBe('b');
  });

  it('Regel nur auf ein Feld', () => {
    const rules: Rule[] = [{ id: '1', categoryId: 'x', keyword: 'Kino', field: 'counterparty', priority: 0 }];
    expect(categorize(tx('Kino Cinedom'), rules)).toBe('x');
    expect(categorize(tx('Max', 'Kino Geld zurück'), rules)).toBeNull();
  });

  it('nutzt den Fallback-Klassifizierer, wenn keine Regel greift', () => {
    const fallback = { classify: () => 'ml-guess' };
    expect(categorize(tx('Irgendwas'), [], { fallback })).toBe('ml-guess');
  });

  it('suggestKeyword entfernt Rechtsformen', () => {
    expect(suggestKeyword('Hausverwaltung Müller GmbH')).toBe('Hausverwaltung Müller');
    expect(suggestKeyword('Zalando SE')).toBe('Zalando');
  });
});
