import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { migrate } from '@/db/schema';
import { DataProvider } from '@/ui/DataProvider';
import { RulePromptProvider } from '@/ui/RulePrompt';
import { useTheme } from '@/ui/theme';

export default function RootLayout() {
  const t = useTheme();
  const base = t.dark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, background: t.bg, card: t.bg, text: t.text, border: t.border, primary: t.accent },
  };

  return (
    <SQLiteProvider databaseName="simplefinance.db" onInit={migrate}>
      <DataProvider>
        <RulePromptProvider>
          <ThemeProvider value={navTheme}>
          <StatusBar style="auto" />
          <Stack
            screenOptions={{
              headerShadowVisible: false,
              headerStyle: { backgroundColor: t.bg },
              headerTintColor: t.text,
              contentStyle: { backgroundColor: t.bg },
              headerBackTitle: 'Zurück',
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="transaction/[id]" options={{ title: 'Buchung', presentation: 'modal' }} />
            <Stack.Screen name="cash-entry" options={{ title: 'Bargeld', presentation: 'modal' }} />
            <Stack.Screen name="category/[id]" options={{ title: 'Kategorie' }} />
            <Stack.Screen name="category-transactions" options={{ title: 'Kategorie' }} />
            <Stack.Screen name="cash" options={{ title: 'Bargeld-Bestand' }} />
            <Stack.Screen name="budget-categories" options={{ title: 'Kategorien einteilen' }} />
            <Stack.Screen name="reimbursements" options={{ title: 'Erstattungen' }} />
          </Stack>
        </ThemeProvider>
        </RulePromptProvider>
      </DataProvider>
    </SQLiteProvider>
  );
}
