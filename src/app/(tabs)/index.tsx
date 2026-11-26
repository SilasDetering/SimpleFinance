import { Text, View } from 'react-native';
import { useTheme } from '@/ui/theme';

export default function Screen() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: t.textMuted }}>Kommt in einer der nächsten Etappen</Text>
    </View>
  );
}
