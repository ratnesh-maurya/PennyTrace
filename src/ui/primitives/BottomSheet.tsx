import React, { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useThemedStyles, type Theme } from '../theme/ThemeProvider';
import { FIXED } from '../theme/palette';
import { RADII } from '../theme/metrics';

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  testID?: string;
}

/** Modal bottom sheet: scrim `rgba(0,0,0,0.42)`, 30px top radius, drag handle, slide-up. */
export function BottomSheet({ visible, onClose, children, testID }: BottomSheetProps) {
  const s = useThemedStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(progress, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setMounted(false);
        }
      });
    }
  }, [progress, visible]);

  if (!mounted) {
    return null;
  }

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [600, 0] });

  return (
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={StyleSheet.absoluteFill} testID={testID}>
        <Animated.View style={[StyleSheet.absoluteFill, s.scrim, { opacity: progress }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
          />
        </Animated.View>
        <Animated.View style={[s.sheet, { paddingBottom: 30 + insets.bottom, transform: [{ translateY }] }]}>
          <View style={s.handle} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    scrim: { backgroundColor: FIXED.scrim },
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: t.c.sheet,
      borderTopLeftRadius: RADII.sheet,
      borderTopRightRadius: RADII.sheet,
      paddingTop: 10,
      paddingHorizontal: 18,
      gap: 14,
      boxShadow: FIXED.sheetShadow,
    },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: t.c.ink3,
      opacity: 0.5,
      alignSelf: 'center',
    },
  });
