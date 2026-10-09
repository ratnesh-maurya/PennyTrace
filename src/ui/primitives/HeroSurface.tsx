import React, { type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { ON_HERO, cssLinearGradient, cssRadialGlow } from '../theme/palette';

interface HeroSurfaceProps {
  radius: number | { tl: number; tr: number; br: number; bl: number };
  /** Draw the accent hero shadow under the surface. */
  shadow?: boolean;
  /** The two radial light blooms of the Daily close hero card. */
  glows?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  testID?: string;
}

/**
 * Accent hero gradient (`linear-gradient(140deg, …)`) drawn with RN's native
 * `backgroundImage`, plus the accent hero shadow. The middle stop is also the
 * background colour, so the surface never renders blank.
 */
export function HeroSurface({ radius, shadow = true, glows = false, style, children, testID }: HeroSurfaceProps) {
  const t = useTheme();
  const r: ViewStyle =
    typeof radius === 'number'
      ? { borderRadius: radius }
      : {
          borderTopLeftRadius: radius.tl,
          borderTopRightRadius: radius.tr,
          borderBottomRightRadius: radius.br,
          borderBottomLeftRadius: radius.bl,
        };
  return (
    <View testID={testID} style={[r, shadow ? { boxShadow: t.heroShadow } : null, style]}>
      <View
        style={[
          StyleSheet.absoluteFill,
          r,
          styles.clip,
          { backgroundColor: t.hero.colors[1], backgroundImage: cssLinearGradient(t.hero) },
        ]}>
        {glows ? (
          <>
            <View style={[styles.glowA, { backgroundImage: cssRadialGlow(ON_HERO.glowA, ON_HERO.glowAClear) }]} />
            <View style={[styles.glowB, { backgroundImage: cssRadialGlow(ON_HERO.glowB, ON_HERO.glowBClear) }]} />
          </>
        ) : null}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  glowA: { position: 'absolute', right: -70, top: -90, width: 240, height: 240, borderRadius: 120 },
  glowB: { position: 'absolute', left: -60, bottom: -110, width: 220, height: 220, borderRadius: 110 },
});
