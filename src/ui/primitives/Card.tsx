import React, { type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useThemedStyles, type Theme } from '../theme/ThemeProvider';

interface CardProps {
  children: ReactNode;
  /** 26 hero-ish, 24 standard, 22 list cards, 20/18 stat tiles. */
  radius?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Surface card with the theme's elevation (soft shadow in light, hairline in dark). */
export function Card({ children, radius = 24, style, testID }: CardProps) {
  const s = useThemedStyles(makeStyles);
  return (
    <View testID={testID} style={[s.card, { borderRadius: radius }, style]}>
      {children}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: t.c.surface,
      boxShadow: t.shadow,
    },
  });

/** Row separator used inside cards: `border-top: 1px solid var(--line)`. */
export function useRowDivider() {
  return useThemedStyles(makeDivider).divider;
}

const makeDivider = (t: Theme) =>
  StyleSheet.create({
    divider: { borderTopWidth: 1, borderTopColor: t.c.line },
  });
