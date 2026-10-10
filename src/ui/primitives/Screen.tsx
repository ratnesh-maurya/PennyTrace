import React, { type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { SPACING } from '../theme/metrics';
import { Text } from './Text';

interface ScreenScrollProps {
  children: ReactNode;
  /** Horizontal padding (18 by default; Activity uses full-bleed rows). */
  padded?: boolean;
  /** Include the status-bar inset (tabs: yes; screens under an app bar: no). */
  topInset?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Vertical screen body: padding `6 18 24`, 14px gap between sections. */
export function ScreenScroll({ children, padded = true, topInset = true, contentStyle, testID }: ScreenScrollProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      testID={testID}
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: (topInset ? insets.top : 0) + SPACING.screenTop,
          paddingHorizontal: padded ? SPACING.screenX : 0,
        },
        contentStyle,
      ]}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </ScrollView>
  );
}

interface ScreenTitleProps {
  title: string;
  /** Small line above the title (13px, ink3). */
  overline?: ReactNode;
  right?: ReactNode;
  align?: 'flex-start' | 'center' | 'flex-end';
}

/** Title block used at the top of each tab: overline + 26px title, optional trailing control. */
export function ScreenTitle({ title, overline, right, align = 'flex-end' }: ScreenTitleProps) {
  return (
    <View style={[styles.titleRow, { alignItems: align }]}>
      <View style={styles.titleCol}>
        {typeof overline === 'string' ? (
          <Text variant="label" color="ink3">
            {overline}
          </Text>
        ) : (
          overline
        )}
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
      </View>
      {right}
    </View>
  );
}

/** Section heading outside a card: `Evidence`, `Sources`, `Own-account transfers`. */
export function SectionHeading({ title, aside }: { title: string; aside?: string }) {
  return (
    <View style={styles.sectionRow}>
      <Text variant="section">{title}</Text>
      {aside ? (
        <Text variant="small" color="ink3">
          {aside}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: SPACING.screenBottom, gap: SPACING.section },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 4,
    paddingHorizontal: 2,
  },
  titleCol: { gap: 2, flexShrink: 1 },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingTop: 6,
    paddingHorizontal: 4,
  },
});
