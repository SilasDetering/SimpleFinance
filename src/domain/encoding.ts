/**
 * Robustes Dekodieren von CSV-Dateien.
 * Die ING exportiert je nach Version UTF-8 (teils mit BOM) oder ISO-8859-1 / Windows-1252.
 * Hermes (die JS-Engine von React Native) kann per TextDecoder nur UTF-8,
 * deshalb dekodieren wir hier selbst.
 */

/** Windows-1252 weicht nur im Bereich 0x80–0x9F von ISO-8859-1 ab. */
const CP1252_HIGH: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020,
  0x87: 0x2021, 0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152,
  0x8e: 0x017d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022,
  0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc, 0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a,
  0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

export type DetectedEncoding = 'utf-8' | 'windows-1252';

/** Prüft, ob die Bytes gültiges UTF-8 sind. */
export function isValidUtf8(bytes: Uint8Array): boolean {
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) {
      i++;
      continue;
    }
    let extra: number;
    if (b >= 0xc2 && b <= 0xdf) extra = 1;
    else if (b >= 0xe0 && b <= 0xef) extra = 2;
    else if (b >= 0xf0 && b <= 0xf4) extra = 3;
    else return false;
    if (i + extra > bytes.length - 1) return false;
    for (let k = 1; k <= extra; k++) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return false;
    }
    i += extra + 1;
  }
  return true;
}

function decodeUtf8(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let cp: number;
    if (b < 0x80) {
      cp = b;
      i += 1;
    } else if (b < 0xe0) {
      cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      i += 2;
    } else if (b < 0xf0) {
      cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      i += 3;
    } else {
      cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      i += 4;
    }
    out += String.fromCodePoint(cp);
  }
  return out;
}

function decodeCp1252(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += String.fromCharCode(b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b] ?? b : b);
  }
  return out;
}

/**
 * Dekodiert Datei-Bytes zu Text: UTF-8 (mit/ohne BOM), sonst Windows-1252 (Obermenge von ISO-8859-1).
 */
export function decodeText(bytes: Uint8Array): { text: string; encoding: DetectedEncoding } {
  let data = bytes;
  if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    data = data.subarray(3);
    return { text: decodeUtf8(data), encoding: 'utf-8' };
  }
  if (isValidUtf8(data)) return { text: decodeUtf8(data), encoding: 'utf-8' };
  return { text: decodeCp1252(data), encoding: 'windows-1252' };
}

/** Hilfsfunktion (Tests, Export): String -> Windows-1252-Bytes. Nicht darstellbare Zeichen werden zu '?'. */
export function encodeCp1252(text: string): Uint8Array {
  const reverse = new Map<number, number>();
  for (const [k, v] of Object.entries(CP1252_HIGH)) reverse.set(v, Number(k));
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80 || (c >= 0xa0 && c <= 0xff)) out[i] = c;
    else out[i] = reverse.get(c) ?? 0x3f;
  }
  return out;
}

/** String -> UTF-8-Bytes (für Tests und Export). */
export function encodeUtf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
  }
  return new Uint8Array(bytes);
}
