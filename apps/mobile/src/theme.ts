import { useColorScheme } from 'react-native';

const palette = {
  light: { bg: '#FAFAF7', ink: '#1C1C1E', quiet: '#8E8E93', line: '#D8D8D2', danger: '#C0392B' },
  dark: { bg: '#111113', ink: '#F2F2F0', quiet: '#8E8E93', line: '#3A3A3C', danger: '#E5675A' },
};

export type Colors = (typeof palette)['light'];

export function useColors(): { c: Colors; dark: boolean } {
  const dark = useColorScheme() === 'dark';
  return { c: dark ? palette.dark : palette.light, dark };
}
