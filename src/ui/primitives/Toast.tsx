import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '../icons';
import { useTheme, useThemedStyles, type Theme } from '../theme/ThemeProvider';
import { FIXED } from '../theme/palette';
import { NAV } from '../theme/metrics';
import { Text } from './Text';

interface ToastProps {
  /** Current message; `null` hides the toast. Timing (2.6 s) is owned by the caller's store. */
  message: string | null;
}

/** Toast from the design: inverted surface, check icon in accent, 100px above the bottom edge. */
export function Toast({ message }: ToastProps) {
  const s = useThemedStyles(makeStyles);
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const opacity = useRef(new Animated.Value(0)).current;
  const last = useRef<string | null>(message);
  if (message) {
    last.current = message;
  }

  useEffect(() => {
    Animated.timing(opacity, { toValue: message ? 1 : 0, duration: 180, useNativeDriver: true }).start();
  }, [message, opacity]);

  const translateY = opacity.interpolate({ inputRange: [0, 1], outputRange: [12, 0] });
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[s.toast, { bottom: NAV.toastOffset + insets.bottom, opacity, transform: [{ translateY }] }]}
    >
      <Icon name="check_circle" size={19} color={c.accent} fill />
      <Text variant="label" color="toastInk" style={s.text}>
        {message ?? last.current ?? ''}
      </Text>
    </Animated.View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    toast: {
      position: 'absolute',
      left: 16,
      right: 16,
      zIndex: 50,
      backgroundColor: t.c.toast,
      borderRadius: 14,
      paddingVertical: 13,
      paddingHorizontal: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      boxShadow: FIXED.toastShadow,
    },
    text: { flex: 1 },
  });
