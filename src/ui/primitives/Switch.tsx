import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { FIXED } from '../theme/palette';

interface SwitchProps {
  value: boolean;
  onValueChange?: (next: boolean) => void;
  disabled?: boolean;
  /** When the whole row is the touch target, render the switch as decoration only. */
  decorative?: boolean;
  accessibilityLabel?: string;
}

/**
 * Material 3 switch as drawn in the design: 50×30 track with a 2px border;
 * thumb grows from 14px (off) to 22px (on).
 */
export function Switch({ value, onValueChange, disabled, decorative, accessibilityLabel }: SwitchProps) {
  const { c } = useTheme();
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, { toValue: value ? 1 : 0, duration: 200, useNativeDriver: false }).start();
  }, [anim, value]);

  const size = anim.interpolate({ inputRange: [0, 1], outputRange: [14, 22] });
  const left = anim.interpolate({ inputRange: [0, 1], outputRange: [5, 22] });
  const margin = anim.interpolate({ inputRange: [0, 1], outputRange: [-7, -11] });

  const track = (
    <Animated.View
      style={[
        styles.track,
        {
          backgroundColor: value ? c.accent : c.surface2,
          borderColor: value ? c.accent : c.ink3,
          opacity: disabled ? 0.45 : 1,
        },
      ]}>
      <Animated.View
        style={[
          styles.thumb,
          {
            width: size,
            height: size,
            left,
            marginTop: margin,
            backgroundColor: value ? c.accentInk : c.ink3,
          },
        ]}
      />
    </Animated.View>
  );

  if (decorative) {
    return track;
  }
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onValueChange?.(!value)}
      hitSlop={8}>
      {track}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: { width: 50, height: 30, borderRadius: 15, borderWidth: 2, flexShrink: 0 },
  thumb: { position: 'absolute', top: '50%', borderRadius: 11, boxShadow: FIXED.thumbShadow },
});
