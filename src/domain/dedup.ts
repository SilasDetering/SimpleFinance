import type { ParsedTransaction } from './types';

/**
 * Duplikaterkennung für überlappende CSV-Importe.
 *
 * Der Schlüssel besteht aus Konto, Buchungsdatum, Betrag, Saldo, Empfänger und Verwendungszweck.
 * Der Saldo macht Buchungen praktisch eindeutig. Für den seltenen Fall exakt gleicher Zeilen
 * wird zusätzlich ein laufender Index angehängt (1. Vorkommen, 2. Vorkommen …), der bei
 * überlappenden Dateien identisch berechnet wird.
 */
export function baseKey(accountId: string, t: ParsedTransaction): string {
  return [
    accountId,
    t.bookingDate,
    t.amountCents,
    t.balanceCents ?? '',
    t.counterparty.toLowerCase(),
    t.purpose.toLowerCase(),
  ].join('|');
}

export function computeDedupKeys(accountId: string, txs: ParsedTransaction[]): string[] {
  const seen = new Map<string, number>();
  return txs.map((t) => {
    const base = baseKey(accountId, t);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}#${n}`;
  });
}

/** Teilt Buchungen in neue und bereits vorhandene auf. */
export function splitDuplicates<T extends ParsedTransaction>(
  accountId: string,
  txs: T[],
  existingKeys: Set<string>,
): { fresh: { tx: T; key: string }[]; duplicates: number } {
  const keys = computeDedupKeys(accountId, txs);
  const fresh: { tx: T; key: string }[] = [];
  let duplicates = 0;
  txs.forEach((tx, i) => {
    if (existingKeys.has(keys[i])) duplicates++;
    else fresh.push({ tx, key: keys[i] });
  });
  return { fresh, duplicates };
}
