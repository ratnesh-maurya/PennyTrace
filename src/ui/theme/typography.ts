import type { TextStyle } from 'react-native';

/**
 * Bundled font files (android/app/src/main/assets/fonts). Never combine these
 * with `fontWeight` — the weight lives in the family name.
 */
export const FONTS = {
  regular: 'Geist-Regular',
  medium: 'Geist-Medium',
  semibold: 'Geist-SemiBold',
  bold: 'Geist-Bold',
  mono: 'GeistMono-Regular',
  monoMedium: 'GeistMono-Medium',
} as const;

export type FontWeight = 400 | 500 | 600 | 700;

export function fontFamilyFor(weight: FontWeight, mono = false): string {
  if (mono) {
    return weight >= 500 ? FONTS.monoMedium : FONTS.mono;
  }
  switch (weight) {
    case 700:
      return FONTS.bold;
    case 600:
      return FONTS.semibold;
    case 500:
      return FONTS.medium;
    default:
      return FONTS.regular;
  }
}

/** CSS `letter-spacing: <em>` → RN absolute letterSpacing. */
const em = (value: number, size: number) => Math.round(value * size * 100) / 100;

interface Variant {
  size: number;
  weight: FontWeight;
  /** letter-spacing in em, as written in the design. */
  tracking?: number;
  /** line-height multiplier, as written in the design (omitted = font default). */
  leading?: number;
  mono?: boolean;
  upper?: boolean;
}

/**
 * Named text styles. Sizes, weights and tracking are lifted from the design;
 * names describe where the design uses them.
 */
const VARIANTS = {
  display: { size: 40, weight: 600, tracking: -0.035, leading: 1 }, // hero closing balance
  amount: { size: 38, weight: 600, tracking: -0.035, leading: 1 }, // detail amount
  position: { size: 34, weight: 600, tracking: -0.03, leading: 1 }, // full financial position
  total: { size: 32, weight: 600, tracking: -0.03, leading: 1 }, // insights spent total
  title: { size: 26, weight: 600, tracking: -0.025 }, // screen titles
  heroTitle: { size: 20, weight: 600, tracking: -0.02, leading: 1.2 }, // privacy hero
  stat18: { size: 18, weight: 600, tracking: -0.015 },
  sheetTitle: { size: 17, weight: 600, tracking: -0.01 },
  dayNum: { size: 17, weight: 600, leading: 1 },
  stat16: { size: 16, weight: 600, tracking: -0.01 },
  navTitle: { size: 16, weight: 600 },
  section: { size: 15, weight: 600 },
  button: { size: 14, weight: 600 },
  bodyStrong: { size: 14, weight: 600 },
  body: { size: 14, weight: 400 },
  rowTitle: { size: 13.5, weight: 500 },
  rowStrong: { size: 13.5, weight: 600 },
  rowValue: { size: 13.5, weight: 600 },
  label: { size: 13, weight: 500 },
  labelStrong: { size: 13, weight: 600 },
  bodySmall: { size: 13, weight: 400, leading: 1.5 },
  caption: { size: 12.5, weight: 500 },
  chip: { size: 12.5, weight: 600 },
  small: { size: 12, weight: 400 },
  smallStrong: { size: 12, weight: 600 },
  meta: { size: 11.5, weight: 400 },
  metaMedium: { size: 11.5, weight: 500 },
  metaStrong: { size: 11.5, weight: 600 },
  eyebrow: { size: 11, weight: 700, tracking: 0.06, upper: true },
  micro: { size: 11, weight: 500 },
  tiny: { size: 10.5, weight: 500 },
  tinyBold: { size: 10.5, weight: 700 },
  dow: { size: 10, weight: 600, tracking: 0.05, upper: true },
  badge: { size: 10, weight: 700, tracking: 0.04 },
  nano: { size: 9.5, weight: 700 },
  mono: { size: 11, weight: 400, leading: 1.5, mono: true },
  monoSmall: { size: 12, weight: 400, mono: true },
} satisfies Record<string, Variant>;

export type TextVariant = keyof typeof VARIANTS;

/** RN 0.87 style types are readonly; build styles with a mutable view. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

function toStyle(v: Variant): TextStyle {
  const style: Mutable<TextStyle> = {
    fontFamily: fontFamilyFor(v.weight, v.mono),
    fontSize: v.size,
  };
  if (v.tracking) {
    style.letterSpacing = em(v.tracking, v.size);
  }
  if (v.leading) {
    style.lineHeight = Math.round(v.size * v.leading * 10) / 10;
  }
  if (v.upper) {
    style.textTransform = 'uppercase';
  }
  return style;
}

export const TYPE: Record<TextVariant, TextStyle> = Object.fromEntries(
  Object.entries(VARIANTS).map(([k, v]) => [k, toStyle(v as Variant)]),
) as Record<TextVariant, TextStyle>;

/** Weight of a variant, so the Text primitive can swap the family when only the weight changes. */
export function variantWeight(variant: TextVariant): FontWeight {
  return (VARIANTS[variant] as Variant).weight;
}

export function variantIsMono(variant: TextVariant): boolean {
  return Boolean((VARIANTS[variant] as Variant).mono);
}

export const TABULAR: TextStyle['fontVariant'] = ['tabular-nums'];
