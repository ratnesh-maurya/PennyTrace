import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, type IconName } from '../icons';
import { FIXED, glow } from '../theme/palette';

interface StatIconProps {
  icon: IconName;
  color: string;
  /** 28 (Today stats) or 30 (Insights stats). */
  size?: number;
  fill?: boolean;
}

/** Solid coloured square with a white glyph and a coloured glow, used on stat tiles. */
export const StatIcon = memo(function StatIcon({ icon, color, size = 28, fill }: StatIconProps) {
  return (
    <View
      style={[
        styles.box,
        {
          width: size,
          height: size,
          borderRadius: size === 28 ? 9 : 10,
          backgroundColor: color,
          boxShadow: glow(color),
        },
      ]}
    >
      <Icon name={icon} size={18} color={FIXED.white} fill={fill} />
    </View>
  );
});

const styles = StyleSheet.create({
  box: { alignItems: 'center', justifyContent: 'center' },
});
