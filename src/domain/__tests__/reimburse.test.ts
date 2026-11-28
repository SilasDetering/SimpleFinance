import { incomeExpense, toLookup } from '../cash';
import { computeBudget } from '../budget';
import { DEFAULT_CATEGORIES } from '../defaults';
import { applyReimbursements, openReimbursements, reimbursements, suggestExpensesFor, suggestPaymentsFor } from '../reimburse';
import { ACCOUNT_GIRO, type Category, type Transaction } from '../types';

const categories: Category[] = DEFAULT_CATEGORIES.map((c, i) => ({ ...c, sortOrder: i, budgetKind: null }));
const lookup = toLookup(categories);

let n = 0;
const tx = (bookingDate: string, amountCents: number, categoryId: string | null, over: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`,
  accountId: ACCOUNT_GIRO,
  bookingDate,
  valueDate: null,
  counterparty: 'X',
  alias: null,
  bookingText: '',
  purpose: '',
  amountCents,
  balanceCents: null,
  categoryId,
  categoryManual: false,
  note: null,
  source: 'csv',
  importId: null,
  dedupKey: null,
  dayOrder: 0,
  ...over,
});

describe('Erstattungen', () => {
  it('offene Ausgabe und zugeordnete Teilzahlung zählen nicht', () => {
    const ticket = tx('2026-10-05', -5000, 'mobility', { reimburseState: 'open', reimburseFrom: 'Arbeit' });
    const pay = tx('2026-10-20', 3000, 'income', { reimbursesId: ticket.id });
    const other = tx('2026-10-21', -1000, 'groceries');
    const all = reimbursements([ticket, pay, other]);
    const r = all.get(ticket.id)!;
    expect(r).toMatchObject({ amountCents: 5000, repaidCents: 3000, openCents: 2000, settled: false });
    expect(openReimbursements(all).map((x) => x.expense.id)).toEqual([ticket.id]);
    expect(applyReimbursements([ticket, pay, other])).toEqual([other]);
  });

  it('abgeschlossene Teilerstattung: Rest bleibt als Ausgabe im Monat der Ausgabe', () => {
    const ticket = tx('2026-10-05', -5000, 'mobility', { reimburseState: 'done' });
    const pay = tx('2026-11-02', 3000, 'income', { reimbursesId: ticket.id });
    const ledger = applyReimbursements([ticket, pay]);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ id: ticket.id, amountCents: -2000, bookingDate: '2026-10-05' });
    expect(incomeExpense(ledger, lookup)).toMatchObject({ incomeCents: 0, expenseCents: 2000 });
  });

  it('vollständig erstattet: fällt ganz weg, auch ohne Abschließen', () => {
    const ticket = tx('2026-10-05', -5000, 'mobility', { reimburseState: 'open' });
    const a = tx('2026-10-10', 2000, 'income', { reimbursesId: ticket.id });
    const b = tx('2026-10-12', 3000, null, { reimbursesId: ticket.id });
    const all = reimbursements([ticket, a, b]);
    expect(all.get(ticket.id)!.settled).toBe(true);
    expect(openReimbursements(all)).toEqual([]);
    expect(applyReimbursements([ticket, a, b])).toEqual([]);
  });

  it('Zuordnung zu einer nicht erstattbaren Ausgabe wird ignoriert', () => {
    const normal = tx('2026-10-05', -5000, 'mobility');
    const pay = tx('2026-10-10', 5000, 'income', { reimbursesId: normal.id });
    const list = [normal, pay];
    expect(applyReimbursements(list)).toBe(list);
  });

  it('Rückzahlungen stören die Erkennung regelmäßiger Einnahmen nicht', () => {
    const list: Transaction[] = [];
    for (const m of ['05', '06', '07', '08', '09', '10']) {
      list.push(tx(`2026-${m}-01`, 300000, 'income', { counterparty: 'Arbeitgeber GmbH' }));
      // jeden Monat eine Dienstreise, die der Arbeitgeber erstattet
      const trip = tx(`2026-${m}-10`, -8000, 'mobility', { reimburseState: 'open' });
      list.push(trip, tx(`2026-${m}-25`, 8000, 'income', { counterparty: 'Arbeitgeber GmbH Reisekosten', reimbursesId: trip.id }));
    }
    const b = computeBudget(applyReimbursements(list), categories, lookup, '2026-11-15');
    expect(b.incomeSources.map((s) => s.name)).toEqual(['Arbeitgeber GmbH']);
    expect(b.incomeCents).toBe(300000);
    expect(b.irregularIncomeCents).toBe(0);
    expect(b.variableTypicalCents).toBe(0);
  });

  it('schlägt passende Eingänge und Ausgaben vor', () => {
    const ticket = tx('2026-10-05', -5000, 'mobility', { reimburseState: 'open' });
    const dinner = tx('2026-10-08', -3000, 'restaurant', { reimburseState: 'open' });
    const before = tx('2026-10-01', 5000, 'income');
    const exact = tx('2026-10-30', 5000, 'income');
    const early = tx('2026-10-09', 1200, 'income');
    const linked = tx('2026-10-10', 999, 'income', { reimbursesId: 'x' });
    const list = [ticket, dinner, before, exact, early, linked];
    expect(suggestPaymentsFor(ticket, 5000, list).map((t) => t.id)).toEqual([exact.id, early.id]);
    const open = openReimbursements(reimbursements(list));
    expect(suggestExpensesFor(tx('2026-10-31', 3000, 'income'), open).map((r) => r.expense.id)).toEqual([dinner.id, ticket.id]);
    expect(suggestExpensesFor(tx('2026-10-06', 3000, 'income'), open).map((r) => r.expense.id)).toEqual([ticket.id]);
  });
});
