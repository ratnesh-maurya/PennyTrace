/**
 * Colour tokens, copied from design/LedgerApp2.dc.html (`Component.THEMES` and
 * `Component.ACCENTS`). Screens never hard-code colours: read them from
 * `useTheme().c`, or from the fixed groups below.
 */

export type ThemeMode = 'light' | 'dark';
export type AccentName = 'blue' | 'sky' | 'violet';
export const ACCENT_NAMES: readonly AccentName[] = ['blue', 'sky', 'violet'];

export interface Palette {
  bg: string;
  surface: string;
  surface2: string;
  sheet: string;
  ink: string;
  ink2: string;
  ink3: string;
  line: string;
  line2: string;
  pos: string;
  posSoft: string;
  out: string;
  outSoft: string;
  warn: string;
  warnSoft: string;
  xfer: string;
  xferSoft: string;
  navBg: string;
  toast: string;
  toastInk: string;
  barSoft: string;
}

/** Card elevation. Light: soft drop shadow. Dark: 1px hairline ring. CSS box-shadow syntax (RN `boxShadow`). */
export const SHADOWS: Record<ThemeMode, string> = {
  light: '0 1px 2px rgba(16,32,72,0.04), 0 8px 24px -12px rgba(16,32,72,0.14)',
  dark: '0 0 0 1px rgba(255,255,255,0.045)',
};

export const PALETTES: Record<ThemeMode, Palette> = {
  light: {
    bg: '#F4F6FB',
    surface: '#FFFFFF',
    surface2: '#EEF1F7',
    sheet: '#FFFFFF',
    ink: '#0B1324',
    ink2: '#46526B',
    ink3: '#8790A5',
    line: 'rgba(11,19,36,0.07)',
    line2: 'rgba(11,19,36,0.13)',
    pos: '#0EA371',
    posSoft: '#DBF5EA',
    out: '#EF3E4A',
    outSoft: '#FDE5E6',
    warn: '#B26B00',
    warnSoft: '#FFF0D4',
    xfer: '#7C3AED',
    xferSoft: '#EFE7FD',
    navBg: '#FFFFFF',
    toast: '#0B1324',
    toastInk: '#FFFFFF',
    barSoft: '#DDE6FF',
  },
  dark: {
    bg: '#060A14',
    surface: '#0F1626',
    surface2: '#18213A',
    sheet: '#111A2E',
    ink: '#EEF2FB',
    ink2: '#A7B1C8',
    ink3: '#717C95',
    line: 'rgba(255,255,255,0.06)',
    line2: 'rgba(255,255,255,0.13)',
    pos: '#2FD69A',
    posSoft: 'rgba(47,214,154,0.14)',
    out: '#FF5F6D',
    outSoft: 'rgba(255,95,109,0.14)',
    warn: '#FFC24D',
    warnSoft: 'rgba(255,194,77,0.13)',
    xfer: '#A887FF',
    xferSoft: 'rgba(168,135,255,0.15)',
    navBg: '#0A1120',
    toast: '#EEF2FB',
    toastInk: '#0A1120',
    barSoft: 'rgba(91,140,255,0.2)',
  },
};

/** A CSS `linear-gradient(<angle>deg, …)` expressed for react-native-linear-gradient (`useAngle`). */
export interface GradientSpec {
  angle: number;
  colors: [string, string, string];
  locations: [number, number, number];
}

export interface AccentColors {
  accent: string;
  accentSoft: string;
  accentInk: string;
  hero: GradientSpec;
  heroShadow: string;
}

const heroStops = (a: string, b: string, c: string): GradientSpec => ({
  angle: 140,
  colors: [a, b, c],
  locations: [0, 0.52, 1],
});

export const ACCENTS: Record<AccentName, Record<ThemeMode, AccentColors>> = {
  blue: {
    light: {
      accent: '#1E5EFF',
      accentSoft: '#E3EBFF',
      accentInk: '#FFFFFF',
      hero: heroStops('#1440DB', '#2563FF', '#4C95FF'),
      heroShadow: '0 20px 36px -18px rgba(30,94,255,0.6)',
    },
    dark: {
      accent: '#5B8EFF',
      accentSoft: 'rgba(91,142,255,0.16)',
      accentInk: '#061230',
      hero: heroStops('#1838D8', '#2E64FF', '#4F9BFF'),
      heroShadow: '0 20px 44px -18px rgba(59,110,255,0.75)',
    },
  },
  sky: {
    light: {
      accent: '#0284C7',
      accentSoft: '#DDF1FC',
      accentInk: '#FFFFFF',
      hero: heroStops('#035E9C', '#0A8FE0', '#3CC4FF'),
      heroShadow: '0 20px 36px -18px rgba(2,132,199,0.6)',
    },
    dark: {
      accent: '#38BDF8',
      accentSoft: 'rgba(56,189,248,0.15)',
      accentInk: '#03243A',
      hero: heroStops('#0369A1', '#0EA5E9', '#48D3FF'),
      heroShadow: '0 20px 44px -18px rgba(14,165,233,0.7)',
    },
  },
  violet: {
    light: {
      accent: '#4F3BF0',
      accentSoft: '#E8E5FE',
      accentInk: '#FFFFFF',
      hero: heroStops('#2E1FC4', '#4F3BF0', '#8A6CFF'),
      heroShadow: '0 20px 36px -18px rgba(79,59,240,0.6)',
    },
    dark: {
      accent: '#8F80FF',
      accentSoft: 'rgba(143,128,255,0.16)',
      accentInk: '#120B3A',
      hero: heroStops('#3422D6', '#5A45FF', '#957BFF'),
      heroShadow: '0 20px 44px -18px rgba(90,69,255,0.75)',
    },
  },
};

/** Ink and fills used on top of the hero gradient (same in both themes). */
export const ON_HERO = {
  text: '#FFFFFF',
  textMuted: 'rgba(255,255,255,0.8)',
  label: 'rgba(255,255,255,0.72)',
  chip: 'rgba(255,255,255,0.18)',
  baseline: 'rgba(255,255,255,0.35)',
  glowA: 'rgba(255,255,255,0.28)',
  glowAClear: 'rgba(255,255,255,0)',
  glowB: 'rgba(120,240,255,0.30)',
  glowBClear: 'rgba(120,240,255,0)',
  dotActive: 'rgba(255,255,255,0.9)',
  // Waterfall bars and their value inks.
  opening: 'rgba(255,255,255,0.3)',
  in: '#5BF2B8',
  inInk: '#D2FFEE',
  spent: '#FF8FA6',
  spentInk: '#FFE0E6',
  moved: '#FFD76A',
  movedInk: '#FFF1C7',
  closing: '#FFFFFF',
} as const;

/** Colours that are fixed by the design regardless of theme. */
export const FIXED = {
  white: '#FFFFFF',
  scrim: 'rgba(0,0,0,0.42)',
  sheetShadow: '0 -20px 40px -20px rgba(0,0,0,0.4)',
  toastShadow: '0 12px 30px -10px rgba(0,0,0,0.45)',
  segmentShadow: '0 1px 3px rgba(0,0,0,0.12)',
  thumbShadow: '0 1px 2px rgba(0,0,0,0.2)',
  detailTileDrop: '0 10px 24px -12px rgba(0,0,0,0.4)',
  /** Background of the "Full financial position" card uses ink/bg inversion, rule colour here. */
  invertedRule: 'rgba(128,128,128,0.25)',
} as const;

/** Hex colour + alpha suffix. `soft('#FF6B2C')` = the design's `color + '24'` (14 %). */
export function withAlpha(hex: string, alphaHex = '24'): string {
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex + alphaHex : hex;
}

/** Coloured glow under the 28px stat icons: `0 6px 14px -6px <color>`. */
export function glow(color: string): string {
  return `0 6px 14px -6px ${color}`;
}

/** CSS form of a gradient spec, for RN's native `backgroundImage` style (New Architecture). */
export function cssLinearGradient(g: GradientSpec): string {
  const stops = g.colors.map((col, i) => `${col} ${Math.round(g.locations[i] * 100)}%`).join(', ');
  return `linear-gradient(${g.angle}deg, ${stops})`;
}

/** `radial-gradient(circle, <inner>, <outer> 65%)` — the hero's soft light blooms. */
export function cssRadialGlow(inner: string, outer: string): string {
  return `radial-gradient(circle, ${inner}, ${outer} 65%)`;
}
