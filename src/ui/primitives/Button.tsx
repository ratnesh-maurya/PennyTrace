import React, { memo } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, type IconName } from '../icons';
import { useTheme } from '../theme/ThemeProvider';
import { Text } from './Text';
import type { TextVariant } from '../theme/typography';

export type ButtonTone = 'ink' | 'outline' | 'accent' | 'soft';

interface ButtonProps {
  label: string;
  onPress?: () => void;
  tone?: ButtonTone;
  /** 40 (Quick check), 48 (Detail), 52 (Sheet save). Radius is height / 2. */
  height?: number;
  icon?: IconName;
  disabled?: boolean;
  flex?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Pill button from the design: ink-filled, outlined, or accent-filled. */
export const Button = memo(function Button({
  label,
  onPress,
  tone = 'ink',
  height = 48,
  icon,
  disabled,
  flex,
  style,
  testID,
}: ButtonProps) {
  const { c } = useTheme();
  const bg = tone === 'ink' ? c.ink : tone === 'accent' ? c.accent : tone === 'soft' ? c.accentSoft : 'transparent';
  const ink = tone === 'ink' ? c.bg : tone === 'accent' ? c.accentInk : tone === 'soft' ? c.accent : c.ink;
  const variant: TextVariant = height >= 52 ? 'section' : height >= 48 ? 'button' : 'labelStrong';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          height,
          borderRadius: height / 2,
          backgroundColor: bg,
          borderWidth: tone === 'outline' ? 1 : 0,
          borderColor: c.line2,
          opacity: disabled ? 0.45 : pressed ? 0.85 : 1,
        },
        flex ? styles.flex : null,
        style,
      ]}>
      <View style={styles.row}>
        {icon ? <Icon name={icon} size={18} color={ink} /> : null}
        <Text variant={variant} color={ink} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
});
