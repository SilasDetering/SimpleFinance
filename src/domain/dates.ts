/** Datums-Hilfen. Intern werden Daten als ISO-String "YYYY-MM-DD" gespeichert. */

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/** "26.11.2026" -> "2026-11-26"; auch "26.11.26". null bei ungültigem Datum. */
export function parseGermanDate(input: string): string | null {
  const m = /^\s*(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})\s*$/.exec(input ?? '');
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (m[3].length === 2) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** "2026-11-26" -> "26.11.2026" */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

/** "2026-11-26" -> "Do., 26. Nov." (kurz für Listen) */
export function formatDayShort(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const wd = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${wd}., ${d}. ${MONTHS_SHORT[m - 1]}.`;
}

/** "2026-11-26" -> "2026-11" */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/** "2026-11" -> "November 2026" */
export function formatMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** "2026-11" -> "Nov" */
export function formatMonthShort(key: string): string {
  const m = Number(key.split('-')[1]);
  return MONTHS_SHORT[m - 1];
}

/** Verschiebt einen Monatsschlüssel um n Monate. */
export function addMonths(key: string, n: number): string {
  const [y, m] = key.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

/** Heutiges Datum als ISO-String (lokale Zeit). */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Tage zwischen zwei ISO-Daten. */
export function daysBetween(a: string, b: string): number {
  const ta = Date.parse(`${a}T00:00:00Z`);
  const tb = Date.parse(`${b}T00:00:00Z`);
  return Math.round((tb - ta) / 86_400_000);
}
