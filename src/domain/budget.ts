import { categoryTypeOf, effectiveCategoryId, type CategoryLookup, type LedgerEntry } from './cash';
import { addMonths, daysBetween, monthKey } from './dates';
import { detectRecurring, groupKey, median, type RecurringPayment } from './recurring';
import { monthsWithData } from './stats';
import { CATEGORY_CASH, CATEGORY_OTHER, CATEGORY_TRANSFER, type BudgetKind, type Category } from './types';

/**
 * Monatsbudget: Wie viel ist pro Monat für Sonderausgaben frei?
 *
 *   Frei verfügbar = regelmäßige Einnahmen − Fixkosten − Sparen
 *
 *  - Grundlage sind die letzten (bis zu) 6 abgeschlossenen Monate. Der laufende Monat zählt nicht mit,
 *    weil er noch unvollständig ist.
 *  - Regelmäßige Einnahmen: Absender, die in mindestens 2/3 dieser Monate etwas überweisen (Gehalt, Kindergeld).
 *    Je Absender zählt der Median der Monatssummen, damit Weihnachtsgeld oder eine Steuererstattung
 *    das Budget nicht aufbläht. Einmalige Einnahmen fließen gar nicht ein.
 *  - Fixkosten und Sparen: je Kategorie der Median der Monatssummen. Was in den letzten 12 Monaten
 *    darüber lag (Jahresbeitrag Versicherung, KFZ-Steuer, Nebenkosten-Nachzahlung), wird auf 12 Monate umgelegt.
 */

type Entry = LedgerEntry & { counterparty: string; alias?: string | null };

export const BUDGET_WINDOW_MONTHS = 6;
const SPREAD_MONTHS = 12;

/** Standard-Rollen der mitgelieferten Kategorien. Alles andere: Ausgaben variabel, Umbuchungen egal. */
const DEFAULT_KIND: Record<string, BudgetKind> = {
  groceries: 'fixed',
  housing: 'fixed',
  subscriptions: 'fixed',
  insurance: 'fixed',
  [CATEGORY_TRANSFER]: 'saving',
};

/** Eigene Kategorien wie „Sparen" oder „ETF" gelten ohne Einstellung als Sparen. */
const SAVING_NAME = /spar|etf|depot|invest|altersvorsorge/i;

/** Welche Rollen bei welchem Kategorie-Typ wählbar sind. */
export function budgetKindsFor(category: Pick<Category, 'id' | 'type'>): BudgetKind[] {
  if (category.id === CATEGORY_CASH || category.type === 'income') return [];
  if (category.type === 'transfer') return ['saving', 'none'];
  return ['fixed', 'variable', 'saving'];
}

export function budgetKindOf(category: Pick<Category, 'id' | 'type' | 'name' | 'budgetKind'> | undefined): BudgetKind {
  if (!category) return 'variable'; // ohne Kategorie = Sonstiges
  const allowed = budgetKindsFor(category);
  if (allowed.length === 0) return 'none';
  if (category.budgetKind && allowed.includes(category.budgetKind)) return category.budgetKind;
  const def = DEFAULT_KIND[category.id];
  if (def && allowed.includes(def)) return def;
  if (SAVING_NAME.test(category.name)) return 'saving';
  return category.type === 'transfer' ? 'none' : 'variable';
}

export const BUDGET_KIND_LABEL: Record<BudgetKind, string> = {
  fixed: 'Fix',
  variable: 'Variabel',
  saving: 'Sparen',
  none: 'Ignorieren',
};

export interface IncomeSource {
  name: string;
  /** typischer Monatsbetrag (Median) */
  monthlyCents: number;
  /** in wie vielen Monaten des Zeitraums eingegangen */
  months: number;
}

export interface PlannedCategory {
  categoryId: string;
  /** typischer Monatsbetrag (Median) */
  baseCents: number;
  /** größere Einmalbeträge der letzten 12 Monate, auf den Monat umgelegt */
  spreadCents: number;
  totalCents: number;
}

export interface Budget {
  /** Monate, aus denen das Budget berechnet ist (aufsteigend) */
  months: string[];
  incomeSources: IncomeSource[];
  incomeCents: number;
  /** Einnahmen im Zeitraum, die nicht regelmäßig sind (nur zur Info) */
  irregularIncomeCents: number;
  fixed: PlannedCategory[];
  fixedCents: number;
  saving: PlannedCategory[];
  savingCents: number;
  /** Frei verfügbar pro Monat für variable Ausgaben */
  freeCents: number;
  /** Sparen / regelmäßige Einnahmen; null ohne Einnahmen */
  savingsRate: number | null;
  /** Typische variable Ausgaben pro Monat (Median im Zeitraum) */
  variableTypicalCents: number;
  /** Monat, für den der Fortschritt gezeigt wird (laufender oder letzter Monat mit Daten) */
  currentMonth: string;
  variableSpentCents: number;
  /** Verbleibende Tage im laufenden Monat inkl. heute; null, wenn der Monat nicht der aktuelle ist */
  daysLeft: number | null;
  /** Wiederkehrende Zahlungen in variablen Kategorien: Kandidaten für „fix" */
  suggestions: RecurringPayment[];
}

function daysInMonth(key: string): number {
  return daysBetween(`${key}-01`, `${addMonths(key, 1)}-01`);
}

/** Monatsliste von `from` bis `to` (inklusive). */
function monthRange(from: string, to: string): string[] {
  const result: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) result.push(m);
  return result;
}

export function computeBudget(entries: Entry[], categories: Category[], lookup: CategoryLookup, today: string): Budget {
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const kindOfCategory = (id: string): BudgetKind => (id === CATEGORY_CASH ? 'none' : budgetKindOf(categoryById.get(id)));
  const kindOf = (e: LedgerEntry): BudgetKind => kindOfCategory(effectiveCategoryId(e));

  const dataMonths = monthsWithData(entries);
  const thisMonth = monthKey(today);
  const currentMonth = dataMonths.includes(thisMonth) || dataMonths.length === 0 ? thisMonth : dataMonths[dataMonths.length - 1];
  const complete = dataMonths.filter((m) => m < thisMonth);
  // Nur Daten aus dem laufenden Monat: besser als nichts, dann eben den nehmen
  const last = complete.length ? complete[complete.length - 1] : dataMonths[dataMonths.length - 1];
  const first = dataMonths[0];

  const empty: Budget = {
    months: [], incomeSources: [], incomeCents: 0, irregularIncomeCents: 0, fixed: [], fixedCents: 0, saving: [],
    savingCents: 0, freeCents: 0, savingsRate: null, variableTypicalCents: 0, currentMonth, variableSpentCents: 0,
    daysLeft: null, suggestions: [],
  };
  if (!last) return empty;

  // Die letzten n Monate bis `last`, aber nicht vor dem ersten Monat mit Daten
  const lastMonths = (n: number) => {
    const from = addMonths(last, -(n - 1));
    return monthRange(from > first ? from : first, last);
  };
  const window = lastMonths(BUDGET_WINDOW_MONTHS);
  const spreadWindow = lastMonths(SPREAD_MONTHS);
  const inWindow = new Set(window);
  const inSpread = new Set(spreadWindow);

  /* Einnahmen nach Absender */
  const incomeGroups = new Map<string, { name: string; byMonth: Map<string, number> }>();
  let incomeTotal = 0;
  for (const e of entries) {
    if (e.amountCents <= 0 || !inWindow.has(monthKey(e.bookingDate))) continue;
    if (categoryTypeOf(e, lookup) !== 'income') continue;
    const name = (e.alias || e.counterparty).trim() || 'Ohne Absender';
    const key = groupKey(name) || name;
    const g = incomeGroups.get(key) ?? { name, byMonth: new Map<string, number>() };
    const m = monthKey(e.bookingDate);
    g.byMonth.set(m, (g.byMonth.get(m) ?? 0) + e.amountCents);
    incomeGroups.set(key, g);
    incomeTotal += e.amountCents;
  }
  const minIncomeMonths = Math.max(1, Math.ceil((window.length * 2) / 3));
  const incomeSources: IncomeSource[] = [];
  let regularInWindow = 0;
  for (const g of incomeGroups.values()) {
    if (g.byMonth.size < minIncomeMonths) continue;
    const monthlyCents = median(window.map((m) => g.byMonth.get(m) ?? 0));
    if (monthlyCents <= 0) continue;
    incomeSources.push({ name: g.name, monthlyCents, months: g.byMonth.size });
    regularInWindow += [...g.byMonth.values()].reduce((s, c) => s + c, 0);
  }
  incomeSources.sort((a, b) => b.monthlyCents - a.monthlyCents);
  const incomeCents = incomeSources.reduce((s, i) => s + i.monthlyCents, 0);

  /* Fixkosten, Sparen und variable Ausgaben je Kategorie und Monat (Abfluss positiv) */
  const outByCat = new Map<string, Map<string, number>>();
  const variableByMonth = new Map<string, number>();
  let variableSpentCents = 0;
  for (const e of entries) {
    const kind = kindOf(e);
    if (kind === 'none') continue;
    const m = monthKey(e.bookingDate);
    if (kind === 'variable') {
      if (categoryTypeOf(e, lookup) !== 'expense') continue;
      if (m === currentMonth) variableSpentCents -= e.amountCents;
      if (inWindow.has(m)) variableByMonth.set(m, (variableByMonth.get(m) ?? 0) - e.amountCents);
      continue;
    }
    if (!inSpread.has(m)) continue;
    const id = effectiveCategoryId(e);
    const byMonth = outByCat.get(id) ?? new Map<string, number>();
    byMonth.set(m, (byMonth.get(m) ?? 0) - e.amountCents);
    outByCat.set(id, byMonth);
  }

  const fixed: PlannedCategory[] = [];
  const saving: PlannedCategory[] = [];
  for (const [categoryId, byMonth] of outByCat) {
    const baseCents = Math.max(0, median(window.map((m) => byMonth.get(m) ?? 0)));
    const excess = spreadWindow.reduce((s, m) => s + Math.max(0, (byMonth.get(m) ?? 0) - baseCents), 0);
    const spreadCents = Math.round(excess / SPREAD_MONTHS);
    const totalCents = baseCents + spreadCents;
    if (totalCents <= 0) continue;
    const item = { categoryId, baseCents, spreadCents, totalCents };
    if (kindOfCategory(categoryId) === 'saving') saving.push(item);
    else fixed.push(item);
  }
  fixed.sort((a, b) => b.totalCents - a.totalCents);
  saving.sort((a, b) => b.totalCents - a.totalCents);
  const fixedCents = fixed.reduce((s, c) => s + c.totalCents, 0);
  const savingCents = saving.reduce((s, c) => s + c.totalCents, 0);

  const suggestions = detectRecurring(entries, lookup).filter(
    (r) => r.categoryId && r.categoryId !== CATEGORY_OTHER && kindOfCategory(r.categoryId) === 'variable',
  );

  return {
    months: window,
    incomeSources,
    incomeCents,
    irregularIncomeCents: incomeTotal - regularInWindow,
    fixed,
    fixedCents,
    saving,
    savingCents,
    freeCents: incomeCents - fixedCents - savingCents,
    savingsRate: incomeCents > 0 ? savingCents / incomeCents : null,
    variableTypicalCents: Math.max(0, median(window.map((m) => variableByMonth.get(m) ?? 0))),
    currentMonth,
    variableSpentCents,
    daysLeft: currentMonth === thisMonth ? daysInMonth(thisMonth) - Number(today.slice(8, 10)) + 1 : null,
    suggestions,
  };
}
