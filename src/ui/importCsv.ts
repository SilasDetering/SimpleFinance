import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import { decodeText } from '@/domain/encoding';
import { parseIngCsv } from '@/domain/ingCsv';
import { ACCOUNT_GIRO } from '@/domain/types';
import { importParsedCsv, type ImportSummary } from '@/db/repo';

/**
 * Öffnet den Datei-Dialog, liest die gewählte ING-CSV (Encoding wird erkannt)
 * und importiert sie ins Girokonto. Gibt null zurück, wenn abgebrochen wurde.
 */
export async function pickAndImportCsv(db: SQLiteDatabase): Promise<ImportSummary | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/comma-separated-values', 'application/csv', 'application/vnd.ms-excel', 'text/plain', '*/*'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  const bytes = await new File(asset.uri).bytes();
  const { text } = decodeText(bytes);
  const parsed = parseIngCsv(text);
  return importParsedCsv(db, ACCOUNT_GIRO, asset.name ?? null, parsed);
}
