import React, { memo } from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { useTheme, type Colors } from '../theme/ThemeProvider';
import {
  TABULAR,
  TYPE,
  fontFamilyFor,
  variantIsMono,
  variantWeight,
  type FontWeight,
  type Mutable,
  type TextVariant,
} from '../theme/typography';

export type ColorToken = keyof Colors;

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  /** A palette token (`ink3`, `accent`, …) or a literal from the fixed token groups. */
  color?: ColorToken | (string & {});
  /** Override the variant's weight (swaps the font file; never sets fontWeight). */
  weight?: FontWeight;
  /** `font-variant-numeric: tabular-nums` — use for every number. */
  tnum?: boolean;
  mono?: boolean;
  align?: TextStyle['textAlign'];
}

export const Text = memo(function Text({
  variant = 'body',
  color = 'ink',
  weight,
  tnum,
  mono,
  align,
  style,
  ...rest
}: TextProps) {
  const { c } = useTheme();
  const resolved = (c as unknown as Record<string, string>)[color] ?? color;
  const base = TYPE[variant];
  const override: Mutable<TextStyle> = { color: resolved };
  if (weight !== undefined || mono !== undefined) {
    override.fontFamily = fontFamilyFor(weight ?? variantWeight(variant), mono ?? variantIsMono(variant));
  }
  if (tnum) {
    override.fontVariant = TABULAR;
  }
  if (align) {
    override.textAlign = align;
  }
  return <RNText allowFontScaling style={[base, override, style]} {...rest} />;
});
