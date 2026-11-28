import { toLookup } from '../cash';
import { budgetKindOf, computeBudget } from '../budget';
import { DEFAULT_CATEGORIES } from '../defaults';
import { ACCOUNT_GIRO, type Category } from '../types';

const baseCategories: Category[] = DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i, budgetKind: null }));
const e = (bookingDate: string, amountCents: number, categoryId: string | null, counterparty = 'X') => ({
  bookingDate,
  amountCents,
  categoryId,
  counterparty,
  accountId: ACCOUNT_GIRO,
});

function months(from: string, count: number): string[] {
  const [y, m] = from.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const total = y * 12 + m - 1 + i;
    return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
  });
}

describe('budgetKindOf', () => {
  const cat = (over: Partial<Category>): Category => ({ ...baseCategories[0], ...over });
  it('nutzt Standards und eigene Einstellung', () => {
    expect(budgetKindOf(cat({ id: 'groceries' }))).toBe('fixed');
    expect(budgetKindOf(cat({ id: 'shopping', name: 'Shopping' }))).toBe('variable');
    expect(budgetKindOf(cat({ id: 'groceries', budgetKind: 'variable' }))).toBe('variable');
    expect(budgetKindOf(cat({ id: 'x', name: 'Sparen', type: 'expense' }))).toBe('saving');
    expect(budgetKindOf(cat({ id: 'transfer', name: 'Umbuchungen/Sparen', type: 'transfer' }))).toBe('saving');
    expect(budgetKindOf(cat({ id: 'y', name: 'Umbuchung', type: 'transfer' }))).toBe('none');
    expect(budgetKindOf(cat({ id: 'income', type: 'income', budgetKind: 'fixed' }))).toBe('none');
    expect(budgetKindOf(cat({ id: 'cash', type: 'transfer', budgetKind: 'saving' }))).toBe('none');
    // „Fix" passt nicht zu einer Umbuchung und wird ignoriert
    expect(budgetKindOf(cat({ id: 'y', name: 'Umbuchung', type: 'transfer', budgetKind: 'fixed' }))).toBe('none');
  });
});

describe('computeBudget', () => {
  const lookup = toLookup(baseCategories);
  // Juni bis November 2026 abgeschlossen, heute ist der 10. Dezember
  const ms = months('2026-06', 6);
  const regular = ms.flatMap((m) => [
    e(`${m}-01`, 250000, 'income', 'Arbeitgeber GmbH'),
    e(`${m}-02`, -90000, 'housing', 'Hausverwaltung'),
    e(`${m}-05`, -1299, 'subscriptions', 'Netflix'),
    e(`${m}-06`, -1500, 'leisure', 'Fitnessstudio Muskel'),
    e(`${m}-10`, -30000, 'transfer', 'Trade Republic'),
    e(`${m}-12`, -20000, 'groceries', 'REWE'),
    e(`${m}-15`, -15000, 'shopping', 'Zalando'),
  ]);
  const extras = [
    // Weihnachtsgeld im November darf das Budget nicht erhöhen
    e('2026-11-20', 200000, 'income', 'Arbeitgeber GmbH'),
    // Einmalige Steuererstattung ist kein regelmäßiges Einkommen
    e('2026-08-20', 40000, 'income', 'Finanzamt'),
    // Jahresbeitrag Haftpflicht: 120 € auf 12 Monate = 10 €
    e('2026-09-01', -12000, 'insurance', 'Haftpflicht AG'),
    // Bargeld ist nie Teil des Budgets
    e('2026-10-01', -10000, 'cash', 'Geldautomat'),
    // laufender Monat
    e('2026-12-03', -4000, 'shopping', 'Zalando'),
    e('2026-12-04', -2500, 'restaurant', 'Pizzeria'),
    e('2026-12-04', -20000, 'groceries', 'REWE'),
  ];
  const b = computeBudget([...regular, ...extras], baseCategories, lookup, '2026-12-10');

  it('nimmt die abgeschlossenen Monate als Grundlage', () => {
    expect(b.months).toEqual(ms);
    expect(b.currentMonth).toBe('2026-12');
    expect(b.daysLeft).toBe(22);
  });

  it('erkennt regelmäßiges Einkommen per Median, ohne Sonderzahlungen', () => {
    expect(b.incomeSources).toEqual([{ name: 'Arbeitgeber GmbH', monthlyCents: 250000, months: 6 }]);
    expect(b.incomeCents).toBe(250000);
    expect(b.irregularIncomeCents).toBe(40000);
  });

  it('rechnet Fixkosten je Kategorie und legt Jahresbeträge um', () => {
    const byId = Object.fromEntries(b.fixed.map((f) => [f.categoryId, f]));
    expect(byId.housing.totalCents).toBe(90000);
    expect(byId.groceries.totalCents).toBe(20000);
    expect(byId.subscriptions.totalCents).toBe(1299);
    expect(byId.insurance).toEqual({ categoryId: 'insurance', baseCents: 0, spreadCents: 1000, totalCents: 1000, planned: false });
    expect(b.fixedCents).toBe(90000 + 20000 + 1299 + 1000);
    expect(b.fixed.some((f) => f.categoryId === 'cash' || f.categoryId === 'shopping')).toBe(false);
  });

  it('zieht Sparen ab und berechnet das freie Budget', () => {
    expect(b.saving).toEqual([{ categoryId: 'transfer', baseCents: 30000, spreadCents: 0, totalCents: 30000, planned: false }]);
    expect(b.savingCents).toBe(30000);
    expect(b.freeCents).toBe(250000 - 112299 - 30000);
    expect(b.savingsRate).toBeCloseTo(0.12);
  });

  it('zählt variable Ausgaben im laufenden Monat und typisch pro Monat', () => {
    expect(b.variableSpentCents).toBe(6500);
    expect(b.variableTypicalCents).toBe(16500);
  });

  it('schlägt wiederkehrende Zahlungen in variablen Kategorien als Fixkosten vor', () => {
    expect(b.suggestions.map((s) => s.name)).toEqual(['Zalando', 'Fitnessstudio Muskel']);
  });

  it('respektiert eigene Einstellungen der Kategorie', () => {
    const cats = baseCategories.map((c) => (c.id === 'groceries' ? { ...c, budgetKind: 'variable' as const } : c));
    const b2 = computeBudget([...regular, ...extras], cats, lookup, '2026-12-10');
    expect(b2.fixed.some((f) => f.categoryId === 'groceries')).toBe(false);
    expect(b2.variableSpentCents).toBe(26500);
  });

  it('kommt mit wenig Daten klar', () => {
    expect(computeBudget([], baseCategories, lookup, '2026-12-10').freeCents).toBe(0);
    const only = computeBudget([e('2026-12-01', 250000, 'income', 'AG')], baseCategories, lookup, '2026-12-10');
    expect(only.months).toEqual(['2026-12']);
    expect(only.incomeCents).toBe(250000);
  });

  it('nimmt einen Planwert statt des berechneten Betrags', () => {
    const cats = baseCategories.map((c) =>
      c.id === 'groceries' ? { ...c, plannedCents: 8000 } : c.id === 'insurance' ? { ...c, plannedCents: 0 } : c,
    );
    const b2 = computeBudget([...regular, ...extras], cats, lookup, '2026-12-10');
    const byId = Object.fromEntries(b2.fixed.map((f) => [f.categoryId, f]));
    expect(byId.groceries).toEqual({ categoryId: 'groceries', baseCents: 8000, spreadCents: 0, totalCents: 8000, planned: true });
    // Planwert 0 nimmt die Kategorie aus dem Budget
    expect(byId.insurance).toBeUndefined();
    expect(b2.fixedCents).toBe(90000 + 8000 + 1299);
    expect(b2.freeCents).toBe(250000 - 99299 - 30000);
  });

  it('plant auch Kategorien ohne Buchungen ein, aber keine variablen', () => {
    const cats = baseCategories.map((c) =>
      c.id === 'health' ? { ...c, budgetKind: 'fixed' as const, plannedCents: 3000 } : c.id === 'shopping' ? { ...c, plannedCents: 5000 } : c,
    );
    const b2 = computeBudget([...regular, ...extras], cats, lookup, '2026-12-10');
    expect(b2.fixed.find((f) => f.categoryId === 'health')?.totalCents).toBe(3000);
    expect(b2.fixed.some((f) => f.categoryId === 'shopping')).toBe(false);
  });

  it('ignoriert ohne Neustart nichts und mit Neustart alle älteren Monate', () => {
    expect(computeBudget([...regular, ...extras], baseCategories, lookup, '2026-12-10', { startMonth: null })).toEqual(b);
    // Masterstudium ab Oktober: vorher kaum Lebensmittel, jetzt 80 € im Monat
    const abroad = ms.slice(0, 4).map((m) => e(`${m}-20`, -550, 'groceries', 'Kiosk'));
    const semester = ['2026-10', '2026-11'].map((m) => e(`${m}-20`, -8000, 'groceries', 'REWE'));
    const data = [...regular.filter((x) => x.categoryId !== 'groceries'), ...abroad, ...semester];
    const before = computeBudget(data, baseCategories, lookup, '2026-12-10');
    expect(before.fixed.find((f) => f.categoryId === 'groceries')?.baseCents).toBe(550);
    const after = computeBudget(data, baseCategories, lookup, '2026-12-10', { startMonth: '2026-10' });
    expect(after.startMonth).toBe('2026-10');
    expect(after.months).toEqual(['2026-10', '2026-11']);
    expect(after.fixed.find((f) => f.categoryId === 'groceries')?.totalCents).toBe(8000);
    // Jahresbeitrag aus September zählt nach dem Neustart nicht mehr
    expect(after.fixed.some((f) => f.categoryId === 'insurance')).toBe(false);
  });

  it('zeigt nach einem Neustart ohne neue Buchungen nur Planwerte', () => {
    const cats = baseCategories.map((c) => (c.id === 'housing' ? { ...c, plannedCents: 40000 } : c));
    const b2 = computeBudget([...regular], cats, lookup, '2026-12-10', { startMonth: '2027-01' });
    expect(b2.months).toEqual([]);
    expect(b2.fixedCents).toBe(40000);
    expect(b2.freeCents).toBe(-40000);
  });
});
