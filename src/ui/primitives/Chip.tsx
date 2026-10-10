import React, { memo, type ReactNode } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';

interface ChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
  /** Filter chips show a count after the label. */
  count?: number;
  /** Leading element, e.g. a 24px account tile. */
  leading?: ReactNode;
  height?: number;
  radius?: number;
  paddingLeft?: number;
  paddingRight?: number;
  /** Background when not selected: `transparent` (Today, Activity) or `surface` (Insights). */
  idleBg?: 'transparent' | 'surface';
  idleInk?: 'ink2' | 'ink';
  testID?: string;
}

/** Selectable chip. Selected = ink fill with bg-coloured text (design: `var(--ink)` / `var(--bg)`). */
export const Chip = memo(function Chip({
  label,
  active,
  onPress,
  count,
  leading,
  height = 32,
  radius = 10,
  paddingLeft = 13,
  paddingRight = 13,
  idleBg = 'transparent',
  idleInk = 'ink2',
  testID,
}: ChipProps) {
  const { c } = useTheme();
  const ink = active ? c.bg : c[idleInk];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          height,
          borderRadius: radius,
          paddingLeft,
          paddingRight,
          borderColor: active ? c.ink : c.line2,
          backgroundColor: active ? c.ink : idleBg === 'surface' ? c.surface : 'transparent',
        },
      ]}
    >
      {leading}
      <Text variant="chip" color={ink} numberOfLines={1}>
        {label}
      </Text>
      {count !== undefined ? (
        <Text variant="micro" color={ink} tnum style={styles.count}>
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    gap: 5,
    flexShrink: 0,
  },
  count: { opacity: 0.7 },
});
