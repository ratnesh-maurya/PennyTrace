import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from './Text';

interface BadgeProps {
  label: string;
  bg: string;
  ink: string;
  /** `tinyBold` (status badges, 10.5px) or `badge` (TODAY marker, 10px tracked). */
  variant?: 'tinyBold' | 'badge';
}

/** 18px tall rounded label: status badges on rows, the TODAY marker. */
export const Badge = memo(function Badge({ label, bg, ink, variant = 'tinyBold' }: BadgeProps) {
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      <Text variant={variant} color={ink} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
});

const styles = StyleSheet.create({
  badge: {
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
});
