import * as fs from 'fs';
import * as path from 'path';
import { computeDedupKeys, splitDuplicates } from '../dedup';
import { decodeText, encodeCp1252, encodeUtf8 } from '../encoding';
import { CsvFormatError, findHeaderRow, parseIngCsv } from '../ingCsv';

const SAMPLES = path.join(__dirname, '../../../samples');
const readSample = (name: string) => new Uint8Array(fs.readFileSync(path.join(SAMPLES, name)));

const MINI = [
  'Umsatzanzeige;Datei erstellt am: 26.11.2026 18:30',
  ';Letztes Update: aktuell',
  '',
  'IBAN;DE89 3704 0044 0532 0130 00',
  'Kontoname;Girokonto',
  'Zeitraum;01.11.2026 - 25.11.2026',
  'Saldo;1.234,56;EUR',
  '',
  'In der CSV-Datei finden Sie alle bereits gebuchten Umsätze.',
  '',
  'Buchung;Valuta;Auftraggeber/Empfänger;Buchungstext;Verwendungszweck;Saldo;Währung;Betrag;Währung',
  '25.11.2026;25.11.2026;Bäckerei Größe;Lastschrift;Brötchen "lecker";1.234,56;EUR;-3,20;EUR',
  '24.11.2026;24.11.2026;Muster GmbH;Gehalt/Rente;Gehalt;1.237,76;EUR;1.000,00;EUR',
  '24.11.2026;24.11.2026;REWE;Lastschrift;Einkauf;237,76;EUR;-12,99;EUR',
].join('\r\n');

describe('decodeText', () => {
  it('erkennt UTF-8', () => {
    const { text, encoding } = decodeText(encodeUtf8('Bäckerei Größe'));
    expect(encoding).toBe('utf-8');
    expect(text).toBe('Bäckerei Größe');
  });

  it('entfernt UTF-8-BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...encodeUtf8('Ä')]);
    expect(decodeText(bytes).text).toBe('Ä');
  });

  it('fällt auf ISO-8859-1/Windows-1252 zurück', () => {
    const { text, encoding } = decodeText(encodeCp1252('Bäckerei Größe – 5 €'));
    expect(encoding).toBe('windows-1252');
    expect(text).toBe('Bäckerei Größe – 5 €');
  });
});

describe('parseIngCsv', () => {
  it('findet die Kopfzeile unabhängig von der Zeilennummer', () => {
    const result = parseIngCsv(MINI);
    expect(result.transactions).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
  });

  it('liest Metadaten', () => {
    const { meta } = parseIngCsv(MINI);
    expect(meta.iban).toBe('DE89 3704 0044 0532 0130 00');
    expect(meta.periodFrom).toBe('2026-11-01');
    expect(meta.periodTo).toBe('2026-11-25');
    expect(meta.balanceCents).toBe(123456);
  });

  it('parst deutsche Datums- und Betragsformate und Umlaute', () => {
    const [first, second] = parseIngCsv(MINI).transactions;
    expect(first).toMatchObject({
      bookingDate: '2026-11-25',
      valueDate: '2026-11-25',
      counterparty: 'Bäckerei Größe',
      bookingText: 'Lastschrift',
      purpose: 'Brötchen "lecker"',
      amountCents: -320,
      balanceCents: 123456,
    });
    expect(second.amountCents).toBe(100000);
  });

  it('vergibt dayOrder chronologisch (Datei ist absteigend sortiert)', () => {
    const txs = parseIngCsv(MINI).transactions;
    const sameDay = txs.filter((t) => t.bookingDate === '2026-11-24');
    // Gehalt steht in der Datei über REWE, ist also später am Tag gebucht
    expect(sameDay.find((t) => t.counterparty === 'Muster GmbH')!.dayOrder).toBeGreaterThan(
      sameDay.find((t) => t.counterparty === 'REWE')!.dayOrder,
    );
  });

  it('akzeptiert die Spalte "Wertstellungsdatum" statt "Valuta"', () => {
    const text = MINI.replace(';Valuta;', ';Wertstellungsdatum;');
    expect(parseIngCsv(text).transactions[0].valueDate).toBe('2026-11-25');
  });

  it('meldet fehlerhafte Zeilen, ohne abzubrechen', () => {
    const text = `${MINI}\r\nxx.11.2026;;Kaputt;;;;EUR;1,00;EUR`;
    const result = parseIngCsv(text);
    expect(result.transactions).toHaveLength(3);
    expect(result.errors).toHaveLength(1);
  });

  it('wirft bei fremdem Format', () => {
    expect(() => parseIngCsv('a;b;c\n1;2;3')).toThrow(CsvFormatError);
  });

  it('findHeaderRow', () => {
    expect(findHeaderRow([['IBAN', 'x'], ['Buchung', 'Valuta', 'Betrag']])).toBe(1);
    expect(findHeaderRow([['foo']])).toBe(-1);
  });

  it('liest die Beispiel-Datei (ISO-8859-1) korrekt', () => {
    const { text, encoding } = decodeText(readSample('ing-beispiel-aug-okt.csv'));
    expect(encoding).toBe('windows-1252');
    const result = parseIngCsv(text);
    expect(result.errors).toEqual([]);
    expect(result.transactions.length).toBeGreaterThan(50);
    expect(result.transactions.some((t) => t.counterparty === 'Hausverwaltung Müller & Söhne')).toBe(true);
    // Saldo-Kette ist konsistent: Saldo(n) = Saldo(n-1) + Betrag(n)
    const chrono = [...result.transactions].sort(
      (a, b) => a.bookingDate.localeCompare(b.bookingDate) || a.dayOrder - b.dayOrder,
    );
    for (let i = 1; i < chrono.length; i++) {
      expect(chrono[i].balanceCents).toBe(chrono[i - 1].balanceCents! + chrono[i].amountCents);
    }
  });
});

describe('Duplikaterkennung', () => {
  it('erkennt Buchungen aus überlappenden Zeiträumen', () => {
    const a = parseIngCsv(decodeText(readSample('ing-beispiel-aug-okt.csv')).text).transactions;
    const b = parseIngCsv(decodeText(readSample('ing-beispiel-okt-nov-ueberlappend.csv')).text).transactions;
    const existing = new Set(computeDedupKeys('giro', a));
    const { fresh, duplicates } = splitDuplicates('giro', b, existing);
    const overlap = b.filter((t) => t.bookingDate <= '2026-10-31').length;
    expect(duplicates).toBe(overlap);
    expect(fresh.every((f) => f.tx.bookingDate > '2026-10-31')).toBe(true);
  });

  it('erneuter Import derselben Datei erzeugt nur Duplikate', () => {
    const a = parseIngCsv(MINI).transactions;
    const { fresh, duplicates } = splitDuplicates('giro', a, new Set(computeDedupKeys('giro', a)));
    expect(fresh).toHaveLength(0);
    expect(duplicates).toBe(3);
  });

  it('exakt gleiche Zeilen innerhalb einer Datei bleiben beide erhalten', () => {
    const row = '24.11.2026;24.11.2026;Automat;Lastschrift;Snack;;EUR;-1,00;EUR';
    const text = `${MINI}\r\n${row}\r\n${row}`;
    const txs = parseIngCsv(text).transactions;
    const keys = computeDedupKeys('giro', txs);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
