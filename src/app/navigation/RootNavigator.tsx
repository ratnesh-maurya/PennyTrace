import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { DarkTheme, DefaultTheme, NavigationContainer, type Theme as NavTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import React, { useMemo } from 'react';
import { AccountDetailScreen } from '../../features/accounts/AccountDetailScreen';
import { AccountsScreen } from '../../features/accounts/AccountsScreen';
import { ActivityScreen } from '../../features/activity/ActivityScreen';
import { TransactionDetailScreen } from '../../features/detail/TransactionDetailScreen';
import { InsightsScreen } from '../../features/insights/InsightsScreen';
import { OnboardingScreen } from '../../features/onboarding/OnboardingScreen';
import { PrivacyScreen } from '../../features/privacy/PrivacyScreen';
import { TodayScreen } from '../../features/today/TodayScreen';
import { useTheme } from '../../ui/theme';
import { TabBar } from './TabBar';
import type { RootStackParamList, TabParamList } from './types';

const Tab = createBottomTabNavigator<TabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

function Tabs() {
  return (
    <Tab.Navigator tabBar={props => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tab.Screen name="Today" component={TodayScreen} />
      <Tab.Screen name="Activity" component={ActivityScreen} />
      <Tab.Screen name="Insights" component={InsightsScreen} />
      <Tab.Screen name="Accounts" component={AccountsScreen} />
      <Tab.Screen name="Privacy" component={PrivacyScreen} />
    </Tab.Navigator>
  );
}

/** Tabs, plus the detail / model / chat screens pushed above them. */
export function RootNavigator({ needsOnboarding }: { needsOnboarding: boolean }) {
  const t = useTheme();
  const navTheme = useMemo<NavTheme>(() => {
    const base = t.mode === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        background: t.c.bg,
        card: t.c.navBg,
        text: t.c.ink,
        border: t.c.line,
        primary: t.c.accent,
      },
    };
  }, [t]);
  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator
        initialRouteName={needsOnboarding ? 'Onboarding' : 'Tabs'}
        screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.c.bg } }}
      >
        <Stack.Screen name="Tabs" component={Tabs} />
        <Stack.Screen
          name="TransactionDetail"
          component={TransactionDetailScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="AccountDetail"
          component={AccountDetailScreen}
          options={{ animation: 'slide_from_right' }}
        />
        <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
