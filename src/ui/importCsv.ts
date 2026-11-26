import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';
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
  // Im Browser (nur für Entwicklung) gibt es kein expo-file-system, dort per fetch lesen
  const bytes =
    Platform.OS === 'web'
      ? new Uint8Array(await (await fetch(asset.uri)).arrayBuffer())
      : await new File(asset.uri).bytes();
  const { text } = decodeText(bytes);
  const parsed = parseIngCsv(text);
  return importParsedCsv(db, ACCOUNT_GIRO, asset.name ?? null, parsed);
}

/** Datei wählen und als Text lesen (für das JSON-Backup). null bei Abbruch. */
export async function pickTextFile(types: string[]): Promise<{ name: string; text: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: types, copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  const bytes =
    Platform.OS === 'web'
      ? new Uint8Array(await (await fetch(asset.uri)).arrayBuffer())
      : await new File(asset.uri).bytes();
  return { name: asset.name ?? 'backup.json', text: decodeText(bytes).text };
}
