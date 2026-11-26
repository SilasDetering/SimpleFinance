import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/** Schreibt Text in eine temporäre Datei und öffnet den Teilen-Dialog. */
export async function shareTextFile(name: string, content: string, mimeType: string): Promise<void> {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(content);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Teilen ist auf diesem Gerät nicht verfügbar.');
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle: name });
}
