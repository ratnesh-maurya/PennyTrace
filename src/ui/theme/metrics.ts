/** Corner radii from the design (px). */
export const RADII = {
  sheet: 30,
  hero: 28,
  card26: 26,
  card24: 24,
  card22: 22,
  strip: 20,
  stat: 18,
  r16: 16,
  r15: 15,
  r14: 14,
  r13: 13,
  r12: 12,
  r11: 11,
  r10: 10,
  r9: 9,
  r8: 8,
  r6: 6,
  r5: 5,
  r3: 3,
  pill: 999,
} as const;

/** Spacing from the design: screen padding `6 18 24`, section gap 14, card padding 16. */
export const SPACING = {
  screenTop: 6,
  screenX: 18,
  screenBottom: 24,
  section: 14,
  card: 16,
  rowY: 10,
} as const;

/** Bottom bar geometry (Material 3 navigation bar from the design). */
export const NAV = {
  pillWidth: 56,
  pillHeight: 32,
  iconSize: 23,
  paddingTop: 10,
  paddingBottom: 4,
  /** Toast sits this far above the bottom edge. */
  toastOffset: 100,
} as const;

export const TOAST_MS = 2600;
