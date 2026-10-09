import React, { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import {
  ACCENTS,
  PALETTES,
  SHADOWS,
  type AccentColors,
  type AccentName,
  type GradientSpec,
  type Palette,
  type ThemeMode,
} from './palette';

export type Colors = Palette & Omit<AccentColors, 'hero' | 'heroShadow'>;

export interface Theme {
  mode: ThemeMode;
  accentName: AccentName;
  c: Colors;
  /** Card elevation as a CSS box-shadow string (RN `boxShadow`). */
  shadow: string;
  hero: GradientSpec;
  heroShadow: string;
  statusBar: 'light-content' | 'dark-content';
}

const cache = new Map<string, Theme>();

export function buildTheme(mode: ThemeMode, accentName: AccentName): Theme {
  const key = `${mode}:${accentName}`;
  const hit = cache.get(key);
  if (hit) {
    return hit;
  }
  const accent = (ACCENTS[accentName] ?? ACCENTS.blue)[mode];
  const theme: Theme = {
    mode,
    accentName,
    c: {
      ...PALETTES[mode],
      accent: accent.accent,
      accentSoft: accent.accentSoft,
      accentInk: accent.accentInk,
    },
    shadow: SHADOWS[mode],
    hero: accent.hero,
    heroShadow: accent.heroShadow,
    statusBar: mode === 'dark' ? 'light-content' : 'dark-content',
  };
  cache.set(key, theme);
  return theme;
}

const ThemeContext = createContext<Theme>(buildTheme('light', 'blue'));

export type ThemePreference = 'system' | ThemeMode;

interface ThemeProviderProps {
  /** `system` follows the device colour scheme. */
  preference?: ThemePreference;
  accent?: AccentName;
  children: ReactNode;
}

export function ThemeProvider({ preference = 'system', accent = 'blue', children }: ThemeProviderProps) {
  const scheme = useColorScheme();
  const mode: ThemeMode = preference === 'system' ? (scheme === 'dark' ? 'dark' : 'light') : preference;
  const theme = buildTheme(mode, accent);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

const styleCache = new WeakMap<object, WeakMap<Theme, unknown>>();

/**
 * Theme-derived styles. Define `const makeStyles = (t: Theme) => StyleSheet.create({...})`
 * at module level and call `useThemedStyles(makeStyles)`; results are cached per theme.
 */
export function useThemedStyles<T>(factory: (theme: Theme) => T): T {
  const theme = useTheme();
  return useMemo(() => {
    let perFactory = styleCache.get(factory);
    if (!perFactory) {
      perFactory = new WeakMap();
      styleCache.set(factory, perFactory);
    }
    if (!perFactory.has(theme)) {
      perFactory.set(theme, factory(theme));
    }
    return perFactory.get(theme) as T;
  }, [factory, theme]);
}
