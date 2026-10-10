import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, type IconName } from '../../ui/icons';
import { Text } from '../../ui/primitives';
import { NAV, useTheme } from '../../ui/theme';
import { useReviewQueue } from '../data/hooks';
import type { TabParamList } from './types';

const TABS: Record<keyof TabParamList, { label: string; icon: IconName }> = {
  Today: { label: 'Today', icon: 'today' },
  Activity: { label: 'Activity', icon: 'receipt_long' },
  Insights: { label: 'Insights', icon: 'insights' },
  Accounts: { label: 'Accounts', icon: 'account_balance' },
  Privacy: { label: 'Privacy', icon: 'shield_lock' },
};

/** Material 3 navigation bar: pill indicator, filled icon when active, review dot on Activity. */
export function TabBar({ state, navigation }: BottomTabBarProps) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const needsReview = useReviewQueue().length > 0;
  return (
    <View
      style={[
        s.bar,
        { backgroundColor: c.navBg, borderTopColor: c.line, paddingBottom: insets.bottom + NAV.paddingBottom },
      ]}
    >
      {state.routes.map((route, index) => {
        const tab = TABS[route.name as keyof TabParamList];
        const active = state.index === index;
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!active && !event.defaultPrevented) {
            navigation.navigate(route.name);
          }
        };
        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            style={s.item}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.label}
            testID={`tab-${route.name}`}
          >
            <View style={[s.pill, active && { backgroundColor: c.accentSoft }]}>
              <Icon name={tab.icon} size={NAV.iconSize} color={active ? c.accent : c.ink2} fill={active} />
              {route.name === 'Activity' && needsReview ? (
                <View style={[s.dot, { backgroundColor: c.warn, borderColor: c.navBg }]} testID="review-dot" />
              ) : null}
            </View>
            <Text variant="smallStrong" weight={active ? 600 : 500} color={active ? 'ink' : 'ink2'}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    paddingTop: NAV.paddingTop,
    paddingHorizontal: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  item: { flex: 1, alignItems: 'center', gap: 4 },
  pill: {
    width: NAV.pillWidth,
    height: NAV.pillHeight,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: 3,
    right: 13,
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 2,
    boxSizing: 'content-box',
  },
});
