import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import { useTheme } from '@/ui/theme';

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.text,
        tabBarInactiveTintColor: t.textFaint,
        tabBarStyle: { backgroundColor: t.bg, borderTopColor: t.border },
        sceneStyle: { backgroundColor: t.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Verlauf',
          tabBarIcon: ({ color, size }) => <Ionicons name="list-outline" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="insights"
        options={{
          title: 'Auswertungen',
          tabBarIcon: ({ color, size }) => <Ionicons name="pie-chart-outline" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="budget"
        options={{
          title: 'Budget',
          tabBarIcon: ({ color, size }) => <Ionicons name="calculator-outline" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Einstellungen',
          tabBarIcon: ({ color, size }) => <Ionicons name="settings-outline" color={color as string} size={size} />,
        }}
      />
    </Tabs>
  );
}
