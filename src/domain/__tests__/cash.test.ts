import { cashBalance, cashEffect, incomeExpense, toLookup, type LedgerEntry } from '../cash';
import { DEFAULT_CATEGORIES } from '../defaults';
import { ACCOUNT_CASH, ACCOUNT_GIRO } from '../types';

const lookup = toLookup(DEFAULT_CATEGORIES);
const bank = (amountCents: number, categoryId: string | null, bookingDate = '2026-11-10'): LedgerEntry => ({
  accountId: ACCOUNT_GIRO,
  amountCents,
  categoryId,
  bookingDate,
});
const cash = (amountCents: number, categoryId: string, bookingDate = '2026-11-10'): LedgerEntry => ({
  accountId: ACCOUNT_CASH,
  amountCents,
  categoryId,
  bookingDate,
});

describe('Bargeld-Kasse', () => {
  it('Abhebung füllt die Kasse auf, ist aber keine Ausgabe', () => {
    const entries = [bank(-10000, 'cash')];
    expect(cashBalance(entries)).toBe(10000);
    expect(incomeExpense(entries, lookup)).toEqual({ incomeCents: 0, expenseCents: 0, saldoCents: 0 });
  });

  it('Bar-Ausgabe verringert die Kasse und zählt als Ausgabe der Kategorie', () => {
    const entries = [bank(-10000, 'cash'), cash(-800, 'groceries')];
    expect(cashBalance(entries)).toBe(9200);
    expect(incomeExpense(entries, lookup)).toEqual({ incomeCents: 0, expenseCents: 800, saldoCents: -800 });
  });

  it('erhaltenes Bargeld erhöht die Kasse und zählt als Einnahme', () => {
    const entries = [cash(5000, 'income')];
    expect(cashBalance(entries)).toBe(5000);
    expect(incomeExpense(entries, lookup).incomeCents).toBe(5000);
  });

  it('Bareinzahlung verringert die Kasse und ist keine Einnahme', () => {
    const entries = [bank(-10000, 'cash'), bank(5000, 'cash')];
    expect(cashBalance(entries)).toBe(5000);
    expect(incomeExpense(entries, lookup).incomeCents).toBe(0);
  });

  it('nichts wird doppelt gezählt (kompletter Zyklus)', () => {
    const entries = [
      bank(285000, 'income'), // Gehalt
      bank(-10000, 'cash'), // 100 € abheben
      cash(-800, 'groceries'), // Bäcker
      cash(-2500, 'restaurant'), // Essen
      bank(5000, 'cash'), // 50 € wieder einzahlen
      bank(-4237, 'groceries'), // REWE per Karte
    ];
    expect(cashBalance(entries)).toBe(10000 - 800 - 2500 - 5000);
    expect(incomeExpense(entries, lookup)).toEqual({
      incomeCents: 285000,
      expenseCents: 800 + 2500 + 4237,
      saldoCents: 285000 - 800 - 2500 - 4237,
    });
  });

  it('negativer Bestand ist möglich (fehlende Abhebung)', () => {
    expect(cashBalance([cash(-800, 'groceries')])).toBe(-800);
  });

  it('Bestand bis zu einem Stichtag', () => {
    const entries = [bank(-10000, 'cash', '2026-10-01'), cash(-800, 'groceries', '2026-11-05')];
    expect(cashBalance(entries, '2026-10-31')).toBe(10000);
  });

  it('normale Bank-Buchungen wirken nicht auf die Kasse', () => {
    expect(cashEffect(bank(-4237, 'groceries'))).toBe(0);
  });
});

describe('incomeExpense', () => {
  it('Umbuchungen werden ignoriert', () => {
    const r = incomeExpense([bank(-20000, 'transfer'), bank(-1000, 'shopping')], lookup);
    expect(r.expenseCents).toBe(1000);
  });

  it('Rückerstattung in einer Ausgabe-Kategorie verringert die Ausgaben', () => {
    const r = incomeExpense([bank(-5000, 'shopping'), bank(2000, 'shopping')], lookup);
    expect(r).toEqual({ incomeCents: 0, expenseCents: 3000, saldoCents: -3000 });
  });

  it('nicht kategorisierte Buchungen zählen als Sonstiges (Ausgabe)', () => {
    expect(incomeExpense([bank(-1750, null)], lookup).expenseCents).toBe(1750);
  });
});
