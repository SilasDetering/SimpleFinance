import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { todayIso } from '@/domain/dates';
import { transactionsToCsv } from '@/domain/exportCsv';
import { BackupFormatError, describeBackup, parseBackup } from '@/domain/backup';
import { deleteAllData, exportBackup, recategorizeAll, restoreBackup } from '@/db/repo';
import { pickTextFile } from '@/ui/importCsv';
import { CategoryBadge, Divider, Icon, ListRow } from '@/ui/components';
import { useData } from '@/ui/DataProvider';
import { shareTextFile } from '@/ui/share';
import { font, radius, space, useTheme } from '@/ui/theme';

export default function SettingsScreen() {
  const t = useTheme();
  const db = useSQLiteContext();
  const { categories, categoryById, rules, transactions, reload } = useData();
  const [busy, setBusy] = useState(false);

  const ruleCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rules) m.set(r.categoryId, (m.get(r.categoryId) ?? 0) + 1);
    return m;
  }, [rules]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Fehler', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () =>
    run(() =>
      shareTextFile(`simplefinance-buchungen-${todayIso()}.csv`, transactionsToCsv(transactions, categoryById), 'text/csv'),
    );

  const exportJson = () =>
    run(async () => {
      const backup = await exportBackup(db);
      await shareTextFile(`simplefinance-backup-${todayIso()}.json`, JSON.stringify(backup, null, 2), 'application/json');
    });

  const restore = () =>
    run(async () => {
      const file = await pickTextFile(['application/json', 'text/plain', '*/*']);
      if (!file) return;
      let backup;
      try {
        backup = parseBackup(file.text);
      } catch (e) {
        throw new Error(e instanceof BackupFormatError ? e.message : String(e));
      }
      const confirmed = backup;
      Alert.alert(
        'Backup wiederherstellen?',
        `${describeBackup(confirmed)}\n\nAlle aktuellen Daten in der App werden dabei ersetzt.`,
        [
          { text: 'Abbrechen', style: 'cancel' },
          {
            text: 'Wiederherstellen',
            style: 'destructive',
            onPress: () =>
              run(async () => {
                await restoreBackup(db, confirmed);
                await reload();
                Alert.alert('Wiederhergestellt', `${confirmed.transactions.length} Buchungen wurden geladen.`);
              }),
          },
        ],
      );
    });

  const reapply = () =>
    run(async () => {
      const n = await recategorizeAll(db);
      await reload();
      Alert.alert('Regeln angewendet', `${n} ${n === 1 ? 'Buchung wurde' : 'Buchungen wurden'} neu zugeordnet. Manuell gesetzte Kategorien bleiben unverändert.`);
    });

  const wipe = () =>
    Alert.alert(
      'Alle Daten löschen?',
      'Alle Buchungen, Importe, eigenen Kategorien und Regeln werden gelöscht. Das kann nicht rückgängig gemacht werden. Tipp: Vorher ein Backup exportieren.',
      [
        { text: 'Abbrechen', style: 'cancel' },
        {
          text: 'Alles löschen',
          style: 'destructive',
          onPress: () =>
            run(async () => {
              await deleteAllData(db);
              await reload();
            }),
        },
      ],
    );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: space.xxl, gap: space.xl }}>
        <Text style={[font.title, { color: t.text, marginTop: space.sm }]}>Einstellungen</Text>

        <View>
          <Text style={[styles.section, font.caption, { color: t.textMuted }]}>Kategorien & Regeln</Text>
          <View style={[styles.group, { backgroundColor: t.surface }]}>
            {categories.map((c, i) => (
              <View key={c.id}>
                {i > 0 ? <Divider /> : null}
                <ListRow
                  title={c.name}
                  subtitle={`${ruleCount.get(c.id) ?? 0} Schlüsselwörter${c.isSystem ? ' · fest' : ''}`}
                  left={<CategoryBadge category={c} size={32} />}
                  onPress={() => router.push({ pathname: '/category/[id]', params: { id: c.id } })}
                />
              </View>
            ))}
            <Divider />
            <ListRow
              title="Neue Kategorie"
              left={
                <View style={[styles.plus, { borderColor: t.border }]}>
                  <Icon name="add" size={18} color={t.text} />
                </View>
              }
              onPress={() => router.push({ pathname: '/category/[id]', params: { id: 'new' } })}
            />
          </View>
          <ListRow title="Regeln auf alle Buchungen anwenden" left={<Icon name="refresh" size={18} color={t.textMuted} />} onPress={reapply} chevron={false} />
        </View>

        <View>
          <Text style={[styles.section, font.caption, { color: t.textMuted }]}>Daten</Text>
          <View style={[styles.group, { backgroundColor: t.surface }]}>
            <ListRow title="Buchungen als CSV exportieren" left={<Icon name="document-text-outline" size={20} color={t.text} />} onPress={exportCsv} chevron={false} />
            <Divider />
            <ListRow title="Backup exportieren (JSON)" left={<Icon name="cloud-download-outline" size={20} color={t.text} />} onPress={exportJson} chevron={false} />
            <Divider />
            <ListRow
              title="Backup wiederherstellen"
              subtitle="Ersetzt alle aktuellen Daten"
              left={<Icon name="cloud-upload-outline" size={20} color={t.text} />}
              onPress={restore}
              chevron={false}
            />
            <Divider />
            <ListRow title="Alle Daten löschen" left={<Icon name="trash-outline" size={20} color="#DC2626" />} onPress={wipe} chevron={false} />
          </View>
          <Text style={[font.small, { color: t.textFaint, marginTop: space.sm }]}>
            Alle Daten liegen nur lokal auf diesem Gerät. Keine Cloud, kein Login.
          </Text>
        </View>

        <Text style={[font.small, { color: t.textFaint, textAlign: 'center' }]}>
          SimpleFinance {Constants.expoConfig?.version ?? ''} · {transactions.length} Buchungen
        </Text>
      </ScrollView>
      {busy ? (
        <View style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: t.overlay }]}>
          <ActivityIndicator color="#fff" size="large" />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  section: { textTransform: 'uppercase', marginBottom: space.sm },
  group: { borderRadius: radius.lg, paddingHorizontal: space.lg },
  plus: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
