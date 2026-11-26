import { useColorScheme } from 'react-native';

export interface Theme {
  dark: boolean;
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
  accent: string;
  income: string;
  expense: string;
  warning: string;
  warningBg: string;
  overlay: string;
}

const light: Theme = {
  dark: false,
  bg: '#FFFFFF',
  surface: '#F6F7F9',
  surfaceAlt: '#EEF0F3',
  text: '#111418',
  textMuted: '#5F6670',
  textFaint: '#9AA0A8',
  border: '#E6E8EC',
  accent: '#2F6BFF',
  income: '#16A34A',
  expense: '#111418',
  warning: '#B45309',
  warningBg: '#FEF3C7',
  overlay: 'rgba(0,0,0,0.35)',
};

const dark: Theme = {
  dark: true,
  bg: '#0E1013',
  surface: '#171A1F',
  surfaceAlt: '#20242B',
  text: '#F2F4F7',
  textMuted: '#A3AAB5',
  textFaint: '#6B7280',
  border: '#262A31',
  accent: '#6E9BFF',
  income: '#4ADE80',
  expense: '#F2F4F7',
  warning: '#FBBF24',
  warningBg: '#3A2E10',
  overlay: 'rgba(0,0,0,0.6)',
};

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };
export const font = {
  hero: { fontSize: 40, fontWeight: '700' as const, letterSpacing: -1 },
  title: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.5 },
  h2: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  bodyStrong: { fontSize: 16, fontWeight: '600' as const },
  small: { fontSize: 13, fontWeight: '400' as const },
  smallStrong: { fontSize: 13, fontWeight: '600' as const },
  caption: { fontSize: 12, fontWeight: '500' as const, letterSpacing: 0.3 },
};
