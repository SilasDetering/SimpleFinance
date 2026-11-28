import { daysBetween } from './dates';
import type { Transaction } from './types';

/**
 * Erstattungen: Geld, das ich auslege und zurückbekomme (Bahnticket für die Arbeit,
 * für einen Freund vorgestreckt).
 *
 *  - Eine Ausgabe wird als „erstattbar" markiert. Solange sie offen ist, zählt sie weder
 *    im Budget noch in den Auswertungen.
 *  - Ein Geldeingang wird der Ausgabe zugeordnet. Er zählt dann nicht als Einnahme und
 *    stört auch die Erkennung regelmäßiger Einnahmen nicht.
 *  - Ist alles zurückgezahlt, ist die Erstattung automatisch erledigt (zählt mit 0).
 *  - Bei einer Teilerstattung schließt man sie von Hand ab: Der Rest bleibt als echte Ausgabe
 *    im Monat der Ausgabe stehen.
 *
 * Konten und Bargeld-Kasse bleiben unberührt, es geht nur um die Auswertung.
 */

export interface Reimbursement<T extends Transaction = Transaction> {
  expense: T;
  /** Zugeordnete Geldeingänge, älteste zuerst */
  payments: T[];
  /** Ausgelegter Betrag, positiv */
  amountCents: number;
  /** Bisher zurückgezahlt, positiv */
  repaidCents: number;
  /** Noch offen (0, wenn alles zurück ist) */
  openCents: number;
  /** Erledigt: alles zurück oder von Hand abgeschlossen */
  settled: boolean;
}

/** Kann diese Buchung als erstattbar markiert werden? (nur Ausgaben, nicht selbst eine Erstattung) */
export function canBeReimbursable(tx: Pick<Transaction, 'amountCents' | 'reimbursesId'>): boolean {
  return tx.amountCents < 0 && !tx.reimbursesId;
}

/** Kann dieser Geldeingang einer Ausgabe zugeordnet werden? */
export function canBeRepayment(tx: Pick<Transaction, 'amountCents' | 'reimburseState'>): boolean {
  return tx.amountCents > 0 && !tx.reimburseState;
}

/** Alle erstattbaren Ausgaben mit ihren Zahlungen, nach Ausgabe-ID. */
export function reimbursements<T extends Transaction>(transactions: T[]): Map<string, Reimbursement<T>> {
  const result = new Map<string, Reimbursement<T>>();
  for (const tx of transactions) {
    if (!tx.reimburseState || tx.amountCents >= 0) continue;
    result.set(tx.id, { expense: tx, payments: [], amountCents: -tx.amountCents, repaidCents: 0, openCents: 0, settled: false });
  }
  for (const tx of transactions) {
    if (!tx.reimbursesId || tx.amountCents <= 0) continue;
    const r = result.get(tx.reimbursesId);
    if (!r) continue;
    r.payments.push(tx);
    r.repaidCents += tx.amountCents;
  }
  for (const r of result.values()) {
    r.payments.sort((a, b) => a.bookingDate.localeCompare(b.bookingDate));
    r.openCents = Math.max(0, r.amountCents - r.repaidCents);
    r.settled = r.openCents === 0 || r.expense.reimburseState === 'done';
  }
  return result;
}

/** Offene Erstattungen, älteste zuerst. */
export function openReimbursements<T extends Transaction>(all: Map<string, Reimbursement<T>>): Reimbursement<T>[] {
  return [...all.values()]
    .filter((r) => !r.settled)
    .sort((a, b) => a.expense.bookingDate.localeCompare(b.expense.bookingDate));
}

/**
 * Buchungen, wie Budget und Auswertungen sie sehen sollen:
 *  - offene erstattbare Ausgaben fallen weg,
 *  - zugeordnete Geldeingänge fallen weg,
 *  - erledigte erstattbare Ausgaben zählen nur mit dem Rest, den ich selbst getragen habe
 *    (zu viel Erstattetes verringert die Kategorie wie eine Gutschrift).
 * Die Reihenfolge bleibt erhalten. Unveränderte Buchungen bleiben dieselben Objekte.
 */
export function applyReimbursements<T extends Transaction>(transactions: T[], all = reimbursements(transactions)): T[] {
  if (all.size === 0) return transactions;
  const result: T[] = [];
  for (const tx of transactions) {
    if (tx.reimbursesId && all.has(tx.reimbursesId)) continue;
    const r = all.get(tx.id);
    if (!r) {
      result.push(tx);
      continue;
    }
    if (!r.settled) continue;
    const net = r.repaidCents - r.amountCents;
    if (net !== 0) result.push({ ...tx, amountCents: net });
  }
  return result;
}

/**
 * Passende offene Erstattungen für einen Geldeingang, beste zuerst:
 * genau passender offener Betrag vor allem anderen, dann nach Abstand des Betrags, dann neuere zuerst.
 * Ausgaben nach dem Eingang kommen nicht in Frage.
 */
export function suggestExpensesFor<T extends Transaction>(payment: Transaction, open: Reimbursement<T>[]): Reimbursement<T>[] {
  return open
    .filter((r) => r.expense.bookingDate <= payment.bookingDate)
    .sort(
      (a, b) =>
        Math.abs(a.openCents - payment.amountCents) - Math.abs(b.openCents - payment.amountCents) ||
        b.expense.bookingDate.localeCompare(a.expense.bookingDate),
    );
}

/**
 * Mögliche Geldeingänge für eine erstattbare Ausgabe, beste zuerst: nicht zugeordnet,
 * am oder nach dem Tag der Ausgabe, höchstens `maxDays` später.
 */
export function suggestPaymentsFor<T extends Transaction>(
  expense: Transaction,
  openCents: number,
  transactions: T[],
  maxDays = 180,
): T[] {
  return transactions
    .filter(
      (tx) =>
        canBeRepayment(tx) &&
        !tx.reimbursesId &&
        tx.bookingDate >= expense.bookingDate &&
        daysBetween(expense.bookingDate, tx.bookingDate) <= maxDays,
    )
    .sort(
      (a, b) =>
        Number(b.amountCents === openCents) - Number(a.amountCents === openCents) ||
        a.bookingDate.localeCompare(b.bookingDate),
    );
}
