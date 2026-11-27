import { formatDate } from './dates';
import { formatCents } from './money';
import { ACCOUNT_CASH, type Category, type Transaction } from './types';

function cell(value: string): string {
  const v = value ?? '';
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Exportiert Buchungen als CSV (Semikolon, deutsche Formate, UTF-8 mit BOM für Excel). */
export function transactionsToCsv(transactions: Transaction[], categories: Map<string, Category>): string {
  const header = ['Datum', 'Konto', 'Auftraggeber/Empfänger', 'Eigener Name', 'Buchungstext', 'Verwendungszweck', 'Kategorie', 'Betrag', 'Notiz'];
  const lines = [header.join(';')];
  const sorted = [...transactions].sort(
    (a, b) => a.bookingDate.localeCompare(b.bookingDate) || a.dayOrder - b.dayOrder,
  );
  for (const tx of sorted) {
    lines.push(
      [
        formatDate(tx.bookingDate),
        tx.accountId === ACCOUNT_CASH ? 'Bargeld' : 'ING Girokonto',
        tx.counterparty,
        tx.alias ?? '',
        tx.bookingText,
        tx.purpose,
        tx.categoryId ? categories.get(tx.categoryId)?.name ?? '' : '',
        formatCents(tx.amountCents, { currency: false }).replace('−', '-'),
        tx.note ?? '',
      ]
        .map(cell)
        .join(';'),
    );
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
