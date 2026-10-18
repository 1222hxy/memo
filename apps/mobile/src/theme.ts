import { useColorScheme } from 'react-native';

const palette = {
  light: {
    bg: '#FAFAF7',
    surface: '#FFFFFF',
    ink: '#1C1C1E',
    quiet: '#8E8E93',
    line: '#D8D8D2',
    danger: '#C0392B',
    accent: '#5B7BE8',
    track: '#E8E8E5',
  },
  dark: {
    bg: '#111113',
    surface: '#1C1C1E',
    ink: '#F2F2F0',
    quiet: '#8E8E93',
    line: '#3A3A3C',
    danger: '#E5675A',
    accent: '#7B96F0',
    track: '#2E2E31',
  },
};

export type Colors = (typeof palette)['light'];

export function useColors(): { c: Colors; dark: boolean } {
  const dark = useColorScheme() === 'dark';
  return { c: dark ? palette.dark : palette.light, dark };
}
