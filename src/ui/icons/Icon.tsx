import React, { memo } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { ICONS, type IconName } from './registry';

export type { IconName } from './registry';

interface IconProps {
  name: IconName;
  /** Glyph box in px (the design's `font-size` for the symbol). */
  size?: number;
  color: string;
  /** Material Symbols `FILL 1`. */
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
}

export const Icon = memo(function Icon({ name, size = 24, color, fill = false, style }: IconProps) {
  const [Outline, Filled] = ICONS[name] ?? ICONS.help;
  const Glyph = fill ? Filled : Outline;
  return <Glyph width={size} height={size} fill={color} color={color} style={style} />;
});

export function isIconName(name: string): name is IconName {
  return Object.prototype.hasOwnProperty.call(ICONS, name);
}

/** Narrow an arbitrary icon string (e.g. from `src/core/categories.ts`) to a known icon. */
export function toIconName(name: string | undefined, fallback: IconName = 'more_horiz'): IconName {
  return name && isIconName(name) ? name : fallback;
}
